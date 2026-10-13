/* CertiBulk — participant list: parsing (TXT/CSV), virtualised table, edit/delete/dedupe */
(function () {
  'use strict';
  var CB = (window.CB = window.CB || {});
  var P = (CB.Participants = {});

  var ROW_H = 44, BUFFER = 6;
  var list = [];
  var nextId = 1;
  var editingId = null;
  var query = '';
  var activeId = null;
  var dupCounts = Object.create(null);
  var lastStart = -1, lastEnd = -1;
  var el = {};

  P.onChange = function () {};
  P.onPick = function () {};
  P.fitCheck = null; // (name) -> layout with .fits

  /* ------------------------------------------------------------ parsing */
  function normName(s) {
    return String(s == null ? '' : s).normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function dupKey(s) { return s.toLocaleLowerCase(); }

  P.normName = normName;

  /** One non-empty line = one participant. Names with several words / commas stay intact. */
  P.parseLines = function (text) {
    var lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
    var names = [], empty = 0;
    for (var i = 0; i < lines.length; i++) {
      var n = normName(lines[i]);
      if (n) names.push(n); else empty++;
    }
    // a trailing newline yields one empty "line" that is not a real blank row
    if (lines.length && !normName(lines[lines.length - 1])) empty = Math.max(0, empty - 1);
    return { names: names, empty: empty };
  };

  function detectDelimiter(text) {
    var counts = { ',': 0, ';': 0, '\t': 0 }, inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ) {
        if (ch === '\n' || ch === '\r') break;
        if (ch in counts) counts[ch]++;
      }
    }
    var best = ',', max = 0;
    for (var k in counts) if (counts[k] > max) { max = counts[k]; best = k; }
    return best;
  }

  /** RFC-4180-style CSV parser (quotes, escaped quotes, delimiters/newlines inside quotes). */
  P.parseCSV = function (text, delimiter) {
    text = String(text).replace(/^﻿/, '');
    var delim = delimiter || detectDelimiter(text);
    var rows = [], row = [], field = '', inQ = false, i = 0, n = text.length, fieldWasQuoted = false;
    while (i < n) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') {
        if (field.trim() !== '') throw new Error('Tanda kutip tidak valid di tengah field (baris ' + (rows.length + 1) + ').');
        field = ''; inQ = true; fieldWasQuoted = true; i++; continue;
      }
      if (ch === delim) { row.push(field); field = ''; fieldWasQuoted = false; i++; continue; }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = ''; fieldWasQuoted = false; i++; continue;
      }
      if (fieldWasQuoted && ch !== ' ' && ch !== '\t') throw new Error('Karakter setelah tanda kutip penutup (baris ' + (rows.length + 1) + ').');
      field += ch; i++;
    }
    if (inQ) throw new Error('Tanda kutip dibuka tetapi tidak ditutup sampai akhir file.');
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return { rows: rows, delimiter: delim };
  };

  /* ---------------------------------------------------------- list ops */
  P.getAll = function () { return list; };
  P.count = function () { return list.length; };
  P.names = function () { return list.map(function (p) { return p.name; }); };
  P.dupGroupCount = function () {
    var n = 0;
    for (var k in dupCounts) if (dupCounts[k] > 1) n += dupCounts[k] - 1;
    return n;
  };

  function recount() {
    dupCounts = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var k = dupKey(list[i].name);
      dupCounts[k] = (dupCounts[k] || 0) + 1;
    }
  }

  function changed(opts) {
    recount();
    lastStart = lastEnd = -1;
    P.render();
    updateMeta();
    P.onChange(opts || {});
  }

  P.add = function (names, replace) {
    if (replace) list = [];
    var out = [];
    for (var i = 0; i < names.length; i++) out.push({ id: nextId++, name: names[i] });
    list = list.concat(out);
    editingId = null;
    changed({ added: out.length });
    return out.length;
  };

  P.clear = function () { list = []; editingId = null; activeId = null; changed({ cleared: true }); };

  function indexOfId(id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return i; return -1; }

  P.removeById = function (id) {
    var i = indexOfId(id);
    if (i < 0) return;
    var removed = list.splice(i, 1)[0];
    if (editingId === id) editingId = null;
    changed({ removed: true });
    CB.UI.toast('“' + removed.name + '” dihapus.', 'info', {
      action: { label: 'Urungkan', onClick: function () { list.splice(Math.min(i, list.length), 0, removed); changed({ added: 1 }); } }
    });
  };

  P.removeDuplicates = function () {
    var seen = Object.create(null), keep = [], removed = 0;
    for (var i = 0; i < list.length; i++) {
      var k = dupKey(list[i].name);
      if (seen[k]) { removed++; continue; }
      seen[k] = true; keep.push(list[i]);
    }
    list = keep; editingId = null;
    changed({ removed: true });
    return removed;
  };

  P.isEditing = function () { return editingId !== null; };

  P.setActive = function (index) {
    activeId = list[index] ? list[index].id : null;
    P.render();
  };

  /* ----------------------------------------------------------- imports */
  function report(msg) { if (el.report) el.report.textContent = msg; }

  function readText(file) {
    if (file.text) return file.text();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result)); };
      fr.onerror = function () { rej(fr.error || new Error('Gagal membaca file')); };
      fr.readAsText(file);
    });
  }

  var HEADER_RE = /^(nama|name|nama peserta|peserta|participant|participants|nama lengkap|full name)$/i;

  P.importFile = async function (file) {
    if (!file) return;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'txt' && ext !== 'csv') {
      CB.UI.toast('Format “.' + ext + '” tidak didukung. Gunakan file .txt atau .csv.', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      CB.UI.toast('File terlalu besar (' + Math.round(file.size / 1048576) + ' MB). Batas yang disarankan 25 MB.', 'error');
      return;
    }
    var text;
    try { text = await readText(file); }
    catch (e) { CB.UI.toast('File tidak dapat dibaca: ' + (e.message || e), 'error'); return; }

    if (text.indexOf('�') >= 0) {
      CB.UI.toast('File mengandung karakter yang tidak terbaca. Simpan ulang file sebagai UTF-8 agar huruf beraksen tampil benar.', 'warn');
    }
    if (ext === 'txt') return importTxt(text, file.name);
    return importCsv(text, file.name);
  };

  function importTxt(text, fname) {
    var r = P.parseLines(text);
    if (!r.names.length) { CB.UI.toast('Tidak ada nama yang ditemukan di ' + fname + '.', 'error'); return; }
    var added = P.add(r.names, false);
    var msg = 'Impor TXT: ' + added + ' nama ditambahkan' + (r.empty ? ', ' + r.empty + ' baris kosong diabaikan.' : '.');
    report(msg); CB.UI.toast(msg, 'success');
  }

  async function importCsv(text, fname) {
    var parsed;
    try { parsed = P.parseCSV(text); }
    catch (e) { CB.UI.toast('File CSV tidak valid: ' + e.message, 'error'); return; }

    var rows = parsed.rows, emptyRows = 0, clean = [];
    for (var i = 0; i < rows.length; i++) {
      var allEmpty = rows[i].every(function (c) { return normName(c) === ''; });
      if (allEmpty) emptyRows++; else clean.push(rows[i]);
    }
    if (!clean.length) { CB.UI.toast('File CSV tidak berisi data.', 'error'); return; }

    var cols = clean.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var colIdx = 0, hasHeader;
    if (cols > 1) {
      var choice = await pickColumn(clean, cols);
      if (!choice) return;
      colIdx = choice.col; hasHeader = choice.header;
    } else {
      hasHeader = HEADER_RE.test(normName(clean[0][0]));
    }
    var names = [];
    for (var j = hasHeader ? 1 : 0; j < clean.length; j++) {
      var n = normName(clean[j][colIdx]);
      if (n) names.push(n); else emptyRows++;
    }
    if (!names.length) { CB.UI.toast('Kolom yang dipilih tidak berisi nama.', 'error'); return; }
    var added = P.add(names, false);
    var msg = 'Impor CSV: ' + added + ' nama ditambahkan' + (emptyRows ? ', ' + emptyRows + ' baris/sel kosong diabaikan.' : '.');
    report(msg); CB.UI.toast(msg, 'success');
  }

  async function pickColumn(rows, cols) {
    var body = document.createElement('div');
    var p = document.createElement('p');
    p.textContent = 'File CSV memiliki ' + cols + ' kolom. Pilih kolom yang berisi nama peserta.';
    var sel = document.createElement('select');
    sel.id = 'csv-col'; sel.setAttribute('aria-label', 'Kolom nama');
    var header = rows[0];
    var guess = 0;
    for (var c = 0; c < cols; c++) {
      var o = document.createElement('option');
      var label = normName(header[c] || '');
      o.value = String(c);
      o.textContent = 'Kolom ' + (c + 1) + (label ? ' — ' + label : '');
      if (HEADER_RE.test(label)) guess = c;
      sel.appendChild(o);
    }
    sel.value = String(guess);
    var lbl = document.createElement('label');
    lbl.className = 'switch'; lbl.style.marginTop = '12px';
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
    var ui = document.createElement('span'); ui.className = 'switch-ui'; ui.setAttribute('aria-hidden', 'true');
    var tx = document.createElement('span'); tx.textContent = 'Baris pertama adalah header';
    lbl.appendChild(cb); lbl.appendChild(ui); lbl.appendChild(tx);
    var prev = document.createElement('p');
    prev.className = 'hint';
    function updatePrev() {
      var c2 = Number(sel.value), vals = [];
      for (var r = cb.checked ? 1 : 0; r < rows.length && vals.length < 3; r++) {
        var v = normName(rows[r][c2] || ''); if (v) vals.push(v);
      }
      prev.textContent = 'Pratinjau: ' + (vals.join(' · ') || '(kosong)');
    }
    sel.addEventListener('change', updatePrev); cb.addEventListener('change', updatePrev); updatePrev();
    body.appendChild(p); body.appendChild(sel); body.appendChild(lbl); body.appendChild(prev);

    var res = await CB.UI.modal({
      title: 'Pilih kolom nama', body: body,
      actions: [{ label: 'Batal', value: 'cancel' }, { label: 'Impor', kind: 'primary', value: 'ok' }],
      dismissValue: 'cancel'
    });
    if (res !== 'ok') return null;
    return { col: Number(sel.value), header: cb.checked };
  }

  /* -------------------------------------------------------------- table */
  function filtered() {
    if (!query) return null;
    var q = query.toLocaleLowerCase(), out = [];
    for (var i = 0; i < list.length; i++) if (list[i].name.toLocaleLowerCase().indexOf(q) >= 0) out.push(i);
    return out;
  }

  function mkBtn(action, label, icon) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'icon-btn'; b.dataset.action = action;
    b.setAttribute('aria-label', label); b.title = label;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + icon);
    svg.appendChild(use); b.appendChild(svg);
    return b;
  }

  function pill(text, cls) {
    var s = document.createElement('span');
    s.className = 'chip ' + cls; s.textContent = text;
    return s;
  }

  function buildRow(idx) {
    var p = list[idx];
    var row = document.createElement('div');
    row.className = 'prow' + (p.id === activeId ? ' active' : '');
    row.setAttribute('role', 'row');
    row.dataset.id = String(p.id);

    var num = document.createElement('span'); num.className = 'num'; num.setAttribute('role', 'cell'); num.textContent = String(idx + 1);
    var name = document.createElement('span'); name.className = 'name'; name.setAttribute('role', 'cell');
    var st = document.createElement('span'); st.className = 'stat-cell'; st.setAttribute('role', 'cell');
    var acts = document.createElement('span'); acts.className = 'acts'; acts.setAttribute('role', 'cell');

    if (p.id === editingId) {
      var inp = document.createElement('input');
      inp.type = 'text'; inp.value = p.name; inp.className = 'edit-input'; inp.setAttribute('aria-label', 'Edit nama peserta nomor ' + (idx + 1));
      name.appendChild(inp);
      acts.appendChild(mkBtn('save', 'Simpan', 'check'));
      acts.appendChild(mkBtn('cancel', 'Batal', 'x'));
    } else {
      name.textContent = p.name; name.title = p.name;
      var bad = false;
      if (dupCounts[dupKey(p.name)] > 1) { st.appendChild(pill('Duplikat', 'warn')); bad = true; }
      if (P.fitCheck) {
        var L = P.fitCheck(p.name);
        if (L && !L.fits) { st.appendChild(pill('Terlalu panjang', 'warn')); bad = true; }
      }
      if (!bad) st.appendChild(pill('OK', 'ok'));
      acts.appendChild(mkBtn('edit', 'Edit ' + p.name, 'edit'));
      acts.appendChild(mkBtn('delete', 'Hapus ' + p.name, 'trash'));
    }
    row.appendChild(num); row.appendChild(name); row.appendChild(st); row.appendChild(acts);
    return row;
  }

  P.render = function (force) {
    if (!el.scroll) return;
    var f = filtered();
    var total = f ? f.length : list.length;
    el.spacer.style.height = (total * ROW_H) + 'px';
    el.empty.hidden = total > 0;
    el.empty.textContent = list.length ? 'Tidak ada nama yang cocok.' : 'Belum ada peserta.';

    var top = el.scroll.scrollTop, h = el.scroll.clientHeight || 340;
    var start = Math.max(0, Math.floor(top / ROW_H) - BUFFER);
    var end = Math.min(total, Math.ceil((top + h) / ROW_H) + BUFFER);
    if (!force && start === lastStart && end === lastEnd) return;
    lastStart = start; lastEnd = end;

    var frag = document.createDocumentFragment();
    for (var i = start; i < end; i++) frag.appendChild(buildRow(f ? f[i] : i));
    el.rows.textContent = '';
    el.rows.appendChild(frag);
    el.rows.style.top = (start * ROW_H) + 'px';

    if (editingId !== null) {
      var inp = el.rows.querySelector('.edit-input');
      if (inp) { inp.focus(); inp.select(); }
    }
  };

  function updateMeta() {
    var n = list.length, dups = P.dupGroupCount();
    el.count.textContent = n + (n === 1 ? ' peserta' : ' peserta') + (query ? ' · menampilkan ' + (filtered() || []).length + ' hasil' : '');
    el.dupbar.hidden = dups === 0;
    if (dups) el.dupText.textContent = dups + ' nama duplikat terdeteksi. Tidak dihapus otomatis.';
  }

  function saveEdit(id, value) {
    var n = normName(value);
    if (!n) { CB.UI.toast('Nama tidak boleh kosong.', 'error'); return false; }
    var i = indexOfId(id);
    if (i >= 0) list[i].name = n;
    editingId = null;
    changed({ edited: true });
    return true;
  }

  /* --------------------------------------------------------------- init */
  P.init = function () {
    el = {
      paste: document.getElementById('p-paste'), report: document.getElementById('p-report'),
      scroll: document.getElementById('p-scroll'), spacer: document.getElementById('p-spacer'),
      rows: document.getElementById('p-rows'), empty: document.getElementById('p-empty'),
      count: document.getElementById('p-count'), dupbar: document.getElementById('p-dupbar'),
      dupText: document.getElementById('p-dup-text'), search: document.getElementById('p-search'),
      newName: document.getElementById('p-new'), file: document.getElementById('file-participants')
    };

    function fromTextarea(replace) {
      var r = P.parseLines(el.paste.value);
      if (!r.names.length) { CB.UI.toast('Tempel minimal satu nama (satu nama per baris).', 'error'); el.paste.focus(); return; }
      var added = P.add(r.names, replace);
      var msg = added + ' nama ' + (replace ? 'menggantikan daftar' : 'ditambahkan') + (r.empty ? ', ' + r.empty + ' baris kosong diabaikan.' : '.');
      report(msg); CB.UI.toast(msg, 'success');
      el.paste.value = '';
    }
    document.getElementById('p-append').addEventListener('click', function () { fromTextarea(false); });
    document.getElementById('p-replace').addEventListener('click', async function () {
      if (list.length) {
        var ok = await CB.UI.confirm('Ganti seluruh daftar?', 'Daftar ' + list.length + ' peserta saat ini akan diganti dengan nama dari kotak teks.', { confirmLabel: 'Ganti daftar', danger: true });
        if (!ok) return;
      }
      fromTextarea(true);
    });

    function pickFile(accept) {
      el.file.accept = accept; el.file.value = ''; el.file.click();
    }
    document.getElementById('p-import-txt').addEventListener('click', function () { pickFile('.txt,text/plain'); });
    document.getElementById('p-import-csv').addEventListener('click', function () { pickFile('.csv,text/csv'); });
    el.file.addEventListener('change', function () {
      var f = el.file.files && el.file.files[0];
      if (f) P.importFile(f);
      el.file.value = '';
    });

    function addOne() {
      var n = normName(el.newName.value);
      if (!n) { CB.UI.toast('Ketik nama terlebih dahulu.', 'error'); el.newName.focus(); return; }
      P.add([n], false); el.newName.value = ''; el.newName.focus();
      el.scroll.scrollTop = el.scroll.scrollHeight;
      P.render(true);
    }
    document.getElementById('p-add').addEventListener('click', addOne);
    el.newName.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addOne(); } });

    document.getElementById('p-clear').addEventListener('click', async function () {
      if (!list.length) { CB.UI.toast('Daftar peserta sudah kosong.', 'info'); return; }
      var ok = await CB.UI.confirm('Hapus semua peserta?', list.length + ' peserta akan dihapus dari daftar. Tindakan ini tidak dapat diurungkan.', { confirmLabel: 'Hapus semua', danger: true });
      if (ok) { P.clear(); report('Daftar peserta dikosongkan.'); }
    });

    document.getElementById('p-dedupe').addEventListener('click', async function () {
      var dups = P.dupGroupCount();
      var ok = await CB.UI.confirm('Hapus nama duplikat?', dups + ' entri duplikat akan dihapus. Kemunculan pertama setiap nama (tanpa membedakan huruf besar/kecil) dipertahankan dan urutan tidak berubah.', { confirmLabel: 'Hapus duplikat', danger: true });
      if (ok) { var r = P.removeDuplicates(); CB.UI.toast(r + ' duplikat dihapus.', 'success'); }
    });

    var st = 0;
    el.search.addEventListener('input', function () {
      clearTimeout(st);
      st = setTimeout(function () { query = el.search.value.trim(); el.scroll.scrollTop = 0; lastStart = lastEnd = -1; P.render(true); updateMeta(); }, 120);
    });

    var sraf = 0;
    el.scroll.addEventListener('scroll', function () {
      if (sraf) return;
      sraf = requestAnimationFrame(function () { sraf = 0; P.render(); });
    });

    el.rows.addEventListener('click', function (e) {
      var row = e.target.closest('.prow'); if (!row) return;
      var id = Number(row.dataset.id);
      var btn = e.target.closest('button[data-action]');
      if (btn) {
        var a = btn.dataset.action;
        if (a === 'edit') { editingId = id; P.render(true); }
        else if (a === 'delete') P.removeById(id);
        else if (a === 'cancel') { editingId = null; P.render(true); }
        else if (a === 'save') { var inp = row.querySelector('.edit-input'); saveEdit(id, inp ? inp.value : ''); }
        return;
      }
      if (e.target.closest('.edit-input')) return;
      var idx = indexOfId(id);
      if (idx >= 0) { activeId = id; P.render(true); P.onPick(idx); }
    });
    el.rows.addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('edit-input')) return;
      var row = e.target.closest('.prow'), id = Number(row.dataset.id);
      if (e.key === 'Enter') { e.preventDefault(); saveEdit(id, e.target.value); }
      else if (e.key === 'Escape') { editingId = null; P.render(true); }
    });

    recount(); P.render(true); updateMeta();
  };
})();
