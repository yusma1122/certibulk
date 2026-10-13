/* CertiBulk — app wiring: UI helpers, state, settings, template upload, controls, generate flow */
(function () {
  'use strict';
  var CB = (window.CB = window.CB || {});
  var $ = function (id) { return document.getElementById(id); };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  /* =================================================================== UI */
  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }
  var TOAST_ICON = { success: 'check', error: 'alert', warn: 'alert', info: 'info' };

  function toast(msg, type, opts) {
    type = type || 'info'; opts = opts || {};
    var root = $('toasts');
    while (root.children.length >= 4) root.firstChild.remove();
    var t = document.createElement('div');
    t.className = 'toast ' + type;
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.appendChild(icon(TOAST_ICON[type] || 'info'));
    var m = document.createElement('div'); m.className = 'toast-msg'; m.textContent = msg;
    t.appendChild(m);
    var timer;
    function remove() { clearTimeout(timer); t.remove(); }
    if (opts.action) {
      var a = document.createElement('button'); a.type = 'button'; a.className = 'toast-act'; a.textContent = opts.action.label;
      a.addEventListener('click', function () { remove(); opts.action.onClick(); });
      t.appendChild(a);
    }
    var x = document.createElement('button'); x.type = 'button'; x.className = 'toast-x'; x.setAttribute('aria-label', 'Tutup notifikasi');
    x.appendChild(icon('x')); x.addEventListener('click', remove);
    t.appendChild(x);
    root.appendChild(t);
    timer = setTimeout(remove, opts.timeout || (type === 'error' ? 8000 : 4500));
  }

  function modal(cfg) {
    return new Promise(function (resolve) {
      var prev = document.activeElement;
      var back = document.createElement('div'); back.className = 'modal-backdrop';
      var box = document.createElement('div'); box.className = 'modal';
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      var h = document.createElement('h3'); h.id = 'modal-title-' + Date.now(); h.textContent = cfg.title;
      box.setAttribute('aria-labelledby', h.id);
      var body = document.createElement('div'); body.className = 'modal-body';
      if (typeof cfg.body === 'string') { var p = document.createElement('p'); p.textContent = cfg.body; body.appendChild(p); }
      else if (cfg.body) body.appendChild(cfg.body);
      if (cfg.list && cfg.list.length) {
        var ul = document.createElement('ul');
        cfg.list.forEach(function (s) { var li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
        body.appendChild(ul);
      }
      var acts = document.createElement('div'); acts.className = 'modal-actions';
      var buttons = [];
      function close(v) {
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* ignore */ } }
        resolve(v);
      }
      cfg.actions.forEach(function (a) {
        var b = document.createElement('button'); b.type = 'button';
        b.className = 'btn' + (a.kind ? ' ' + a.kind : ''); b.textContent = a.label;
        b.addEventListener('click', function () { close(a.value); });
        acts.appendChild(b); buttons.push(b);
      });
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cfg.dismissValue); }
        else if (e.key === 'Tab') {
          var f = box.querySelectorAll('button,select,input,textarea,[href]');
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('mousedown', function (e) { if (e.target === back) close(cfg.dismissValue); });
      box.appendChild(h); box.appendChild(body); box.appendChild(acts);
      back.appendChild(box);
      $('modal-root').appendChild(back);
      var primary = acts.querySelector('.primary, .danger') || buttons[buttons.length - 1];
      var focusEl = body.querySelector('select,input') || primary;
      if (focusEl) focusEl.focus();
    });
  }

  function confirmDialog(title, message, o) {
    o = o || {};
    return modal({
      title: title, body: message, dismissValue: false,
      actions: [{ label: o.cancelLabel || 'Batal', value: false }, { label: o.confirmLabel || 'Lanjutkan', kind: o.danger ? 'danger' : 'primary', value: true }]
    });
  }

  CB.UI = { toast: toast, modal: modal, confirm: confirmDialog };

  /* ============================================================== STATE */
  var KEY = 'certibulk.settings.v1';
  var DEFAULT_DESIGN = {
    x: 960, y: 560, fontFamily: 'Poppins', fontSize: 72, fontWeight: 700, italic: false,
    color: '#1F2937', align: 'center', letterSpacing: 0, maxWidth: 1300, rotation: 0,
    autoFit: true, minFontSize: 24
  };
  var DEFAULT_EXPORT = { format: 'png', quality: 92, pattern: 'Sertifikat_{name}', zipName: 'CertiBulk_Certificates' };
  var REF = { w: 1920, h: 1080 };

  var state = {
    img: null, imgInfo: null,
    design: clone(DEFAULT_DESIGN), exp: clone(DEFAULT_EXPORT),
    projectName: 'Proyek Sertifikat', sampleName: 'Nama Peserta',
    templateSize: null,
    previewMode: 'design', previewIndex: 0, previewed: false,
    zoom: 'fit', guides: true, view: 'workspace',
    generated: false, lastResult: null, downloaded: false
  };
  CB.state = state;

  var P, Editor;
  var mq = window.matchMedia ? window.matchMedia('(max-width: 900px)') : { matches: false };
  function isMobile() { return mq.matches; }

  /* ------------------------------------------------------------ storage */
  function sanitizeDesign(src) {
    var d = clone(DEFAULT_DESIGN);
    if (!src || typeof src !== 'object') return d;
    function num(k, lo, hi) {
      var v = Number(src[k]);
      if (src[k] !== null && src[k] !== '' && src[k] !== undefined && isFinite(v)) d[k] = clamp(v, lo, hi);
    }
    num('x', 0, 100000); num('y', 0, 100000); num('fontSize', 4, 3000); num('letterSpacing', -50, 300);
    num('maxWidth', 10, 100000); num('rotation', -360, 360); num('minFontSize', 1, 3000);
    if (CB.FONTS.some(function (f) { return f.id === src.fontFamily; })) d.fontFamily = src.fontFamily;
    if (Number(src.fontWeight) === 400 || Number(src.fontWeight) === 700) d.fontWeight = Number(src.fontWeight);
    d.italic = !!src.italic;
    if (typeof src.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.color)) d.color = src.color.toUpperCase();
    if (['left', 'center', 'right'].indexOf(src.align) >= 0) d.align = src.align;
    d.autoFit = src.autoFit === undefined ? true : !!src.autoFit;
    return d;
  }
  function sanitizeExport(src) {
    var e = clone(DEFAULT_EXPORT);
    if (!src || typeof src !== 'object') return e;
    if (src.format === 'jpg' || src.format === 'png') e.format = src.format;
    var q = Number(src.quality); if (isFinite(q)) e.quality = clamp(Math.round(q), 50, 100);
    if (typeof src.pattern === 'string') e.pattern = src.pattern.slice(0, 120);
    if (typeof src.zipName === 'string') e.zipName = src.zipName.slice(0, 100);
    return e;
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      state.design = sanitizeDesign(o.design);
      state.exp = sanitizeExport(o.export);
      if (typeof o.projectName === 'string') state.projectName = o.projectName.slice(0, 80);
      if (typeof o.sampleName === 'string' && o.sampleName.trim()) state.sampleName = o.sampleName.slice(0, 120);
      if (o.templateSize && isFinite(o.templateSize.w) && isFinite(o.templateSize.h) && o.templateSize.w > 0 && o.templateSize.h > 0) {
        state.templateSize = { w: o.templateSize.w, h: o.templateSize.h };
      }
    } catch (e) { /* corrupted or unavailable storage: continue with defaults */ }
  }

  var saveTimer = 0, saveWarned = false;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          v: 1, projectName: state.projectName, sampleName: state.sampleName,
          design: state.design, export: state.exp, templateSize: state.templateSize
        }));
      } catch (e) {
        if (!saveWarned) {
          saveWarned = true;
          toast('Pengaturan tidak dapat disimpan di browser ini (penyimpanan lokal dinonaktifkan atau penuh). Aplikasi tetap berfungsi, tetapi pengaturan akan hilang saat halaman dimuat ulang.', 'warn', { timeout: 9000 });
        }
      }
    }, 300);
  }

  /* ----------------------------------------------------------- template */
  function imgW() { return state.img ? (state.img.naturalWidth || state.img.width) : 100000; }
  function imgH() { return state.img ? (state.img.naturalHeight || state.img.height) : 100000; }

  /** When template size differs from the size the settings were made for, scale position and sizes proportionally. */
  function adaptDesignToTemplate(w, h) {
    var ref = state.templateSize || REF;
    var d = state.design;
    if (ref.w !== w || ref.h !== h) {
      var sx = w / ref.w, sy = h / ref.h;
      d.x = Math.round(d.x * sx); d.y = Math.round(d.y * sy);
      d.fontSize = Math.max(4, Math.round(d.fontSize * sx));
      d.maxWidth = Math.max(10, Math.round(d.maxWidth * sx));
      d.minFontSize = Math.max(1, Math.round(d.minFontSize * sx));
      d.letterSpacing = Math.round(d.letterSpacing * sx * 2) / 2;
    }
    d.x = clamp(d.x, 0, w); d.y = clamp(d.y, 0, h);
    state.templateSize = { w: w, h: h };
  }

  function releaseImage() {
    if (state.imgInfo && state.imgInfo.url) { URL.revokeObjectURL(state.imgInfo.url); }
  }

  async function loadTemplateFile(file) {
    if (!file) return;
    var okType = /^image\/(png|jpeg)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
    if (!okType || /\.(gif|webp|svg|bmp)$/i.test(file.name)) {
      toast('Format file tidak didukung. Gunakan gambar PNG, JPG, atau JPEG.', 'error'); return;
    }
    if (!file.size) { toast('File kosong (0 byte). Pilih gambar lain.', 'error'); return; }
    var url = URL.createObjectURL(file);
    var im = new Image();
    try {
      await new Promise(function (res, rej) {
        im.onload = res; im.onerror = function () { rej(new Error('decode')); };
        im.src = url;
      });
      if (im.decode) { try { await im.decode(); } catch (e) { /* onload already succeeded */ } }
    } catch (e) {
      URL.revokeObjectURL(url);
      toast('Gambar tidak dapat dibaca. File mungkin rusak atau bukan PNG/JPG yang valid.', 'error'); return;
    }
    var w = im.naturalWidth, h = im.naturalHeight;
    if (!w || !h) { URL.revokeObjectURL(url); toast('Dimensi gambar tidak valid.', 'error'); return; }
    if (w > 16384 || h > 16384 || w * h > 268435456) {
      URL.revokeObjectURL(url);
      toast('Gambar terlalu besar (' + w + '×' + h + '). Batas browser sekitar 16.384 piksel per sisi. Perkecil gambar terlebih dahulu.', 'error'); return;
    }
    releaseImage();
    state.img = im;
    state.imgInfo = { name: file.name, w: w, h: h, size: file.size, type: file.type || 'image/' + (/png$/i.test(file.name) ? 'png' : 'jpeg'), url: url };
    adaptDesignToTemplate(w, h);
    var big = w * h > 16777216;
    $('c-size-r').max = String(Math.max(200, Math.round(h * 0.3)));
    Editor.setImage(im);
    syncControls();
    persist();
    refresh();
    if (state.view === 'workspace' || state.view === 'template') showView('editor', { open: false });
    toast('Template dimuat: ' + w + ' × ' + h + ' px.', 'success');
    if (big && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      toast('Gambar sangat besar; Safari di iOS mungkin gagal mengekspor di atas ±16 megapiksel.', 'warn', { timeout: 8000 });
    }
    checkFont();
  }

  function removeTemplate() {
    releaseImage();
    state.img = null; state.imgInfo = null;
    Editor.setImage(null);
    refresh(); syncControls();
    toast('Template dihapus.', 'info');
  }

  /* ---------------------------------------------------------------- views */
  var VIEW_TITLES = { workspace: 'Workspace', template: 'Certificate Template', editor: 'Name Editor', participants: 'Participants', export: 'Export', settings: 'Pengaturan' };
  function showView(name, o) {
    o = o || {};
    state.view = name;
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
    document.querySelectorAll('.nav-item').forEach(function (b) {
      if (b.dataset.view === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('panel-title').textContent = VIEW_TITLES[name] || name;
    $('panel').querySelector('.panel-body').scrollTop = 0;
    if (isMobile() && o.open !== false) $('panel').classList.add('open');
    if (name === 'participants') P.render(true);
    if (name === 'export') updateExportInfo();
  }

  /* ------------------------------------------------------------- controls */
  var fontToken = 0;
  function syncControls() {
    var d = state.design, ae = document.activeElement;
    function setv(id, v) { var el = $(id); if (el && el !== ae) el.value = String(v); }
    setv('c-sample', state.sampleName);
    setv('c-font', d.fontFamily);
    var f = CB.fontById(d.fontFamily), w = $('c-weight');
    Array.prototype.forEach.call(w.options, function (o) { o.disabled = f.weights.indexOf(Number(o.value)) < 0; });
    if (w !== ae) w.value = String(CB.effectiveWeight(d));
    $('c-italic').checked = !!d.italic;
    setv('c-color', d.color.toLowerCase()); setv('c-color-hex', d.color);
    setv('c-size', d.fontSize); setv('c-size-r', d.fontSize);
    setv('c-ls', d.letterSpacing); setv('c-ls-r', d.letterSpacing);
    setv('c-x', d.x); setv('c-y', d.y); setv('c-maxw', d.maxWidth);
    setv('c-rot', d.rotation); setv('c-rot-r', d.rotation);
    $('c-autofit').checked = !!d.autoFit;
    setv('c-minsize', d.minFontSize);
    document.querySelectorAll('#c-align .seg-btn').forEach(function (b) {
      b.setAttribute('aria-checked', b.dataset.align === d.align ? 'true' : 'false');
    });
    setv('s-project', state.projectName);
    document.title = (state.projectName ? state.projectName + ' — ' : '') + 'CertiBulk';
  }

  var tableRaf = 0;
  function scheduleTable() {
    if (tableRaf) return;
    tableRaf = requestAnimationFrame(function () { tableRaf = 0; if (!P.isEditing()) P.render(true); });
  }

  function designChanged() {
    syncControls(); persist(); Editor.redraw(); scheduleTable(); refresh();
  }

  function bindNum(ids, key, min, max) {
    function val(x) { return typeof x === 'function' ? x() : x; }
    ids.forEach(function (id) {
      var el = $(id);
      el.addEventListener('input', function () {
        var v = parseFloat(el.value);
        if (!isFinite(v) || v < val(min) || v > val(max)) { if (el.type === 'number') el.classList.add('invalid'); return; }
        el.classList.remove('invalid');
        state.design[key] = v;
        designChanged();
      });
      el.addEventListener('change', function () {
        var v = parseFloat(el.value);
        if (!isFinite(v)) v = state.design[key];
        v = clamp(v, val(min), val(max));
        state.design[key] = v;
        el.classList.remove('invalid');
        designChanged();
        el.value = String(v);
      });
    });
  }

  async function checkFont() {
    var token = ++fontToken;
    var av = await CB.ensureFont(state.design, Editor.previewText());
    if (token !== fontToken) return;
    var note = $('font-note'), f = CB.fontById(state.design.fontFamily);
    if (!av.available) {
      var generic = /cursive/.test(f.stack) ? 'cursive' : /serif/.test(f.stack) && !/sans-serif/.test(f.stack) ? 'serif' : 'sans-serif';
      note.textContent = 'Font “' + f.label + '” ' + (av.local ? 'gagal dimuat dari file lokal' : 'tidak ditemukan di perangkat ini') + '. Memakai font cadangan (' + generic + ').';
      note.style.color = 'var(--warn)';
      if (state.fontWarned !== f.id) { state.fontWarned = f.id; toast(note.textContent, 'warn', { timeout: 7000 }); }
    } else {
      note.style.color = '';
      note.textContent = (av.local ? 'Font lokal dimuat.' : 'Font sistem tersedia.') + (f.weights.length === 1 ? ' Font ini hanya punya gaya Regular.' : '');
    }
    Editor.redraw();
  }

  function bindControls() {
    var fontSel = $('c-font');
    CB.FONTS.forEach(function (f) { var o = document.createElement('option'); o.value = f.id; o.textContent = f.label + (f.local ? '' : ' (sistem)'); fontSel.appendChild(o); });

    $('c-sample').addEventListener('input', function (e) { state.sampleName = e.target.value; persist(); Editor.redraw(); });
    fontSel.addEventListener('change', function () {
      var d = state.design; d.fontFamily = fontSel.value;
      var f = CB.fontById(d.fontFamily);
      if (f.weights.indexOf(d.fontWeight) < 0) d.fontWeight = f.weights[0];
      designChanged(); checkFont();
    });
    $('c-weight').addEventListener('change', function (e) { state.design.fontWeight = Number(e.target.value); designChanged(); checkFont(); });
    $('c-italic').addEventListener('change', function (e) { state.design.italic = e.target.checked; designChanged(); checkFont(); });

    $('c-color').addEventListener('input', function (e) { state.design.color = e.target.value.toUpperCase(); designChanged(); });
    var hex = $('c-color-hex');
    hex.addEventListener('input', function () {
      var v = hex.value.trim(); if (v && v[0] !== '#') v = '#' + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { hex.classList.remove('invalid'); state.design.color = v.toUpperCase(); designChanged(); }
      else hex.classList.add('invalid');
    });
    hex.addEventListener('change', function () { hex.classList.remove('invalid'); hex.value = state.design.color; });

    document.querySelectorAll('#c-align .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { state.design.align = b.dataset.align; designChanged(); });
    });

    bindNum(['c-size', 'c-size-r'], 'fontSize', 4, 3000);
    bindNum(['c-ls', 'c-ls-r'], 'letterSpacing', -50, 300);
    bindNum(['c-x'], 'x', 0, imgW);
    bindNum(['c-y'], 'y', 0, imgH);
    bindNum(['c-maxw'], 'maxWidth', 10, 100000);
    bindNum(['c-rot', 'c-rot-r'], 'rotation', -360, 360);
    bindNum(['c-minsize'], 'minFontSize', 1, 3000);
    $('c-autofit').addEventListener('change', function (e) { state.design.autoFit = e.target.checked; designChanged(); });
    $('c-center').addEventListener('click', function () {
      if (!state.img) { toast('Unggah template terlebih dahulu.', 'info'); return; }
      state.design.x = Math.round(imgW() / 2); state.design.align = 'center'; designChanged();
    });
  }

  /* ---------------------------------------------------------------- export */
  function exampleName() {
    var names = P.names();
    var ext = CB.Export.extFor(state.exp.format);
    var namer = CB.Export.makeNamer({ pattern: state.exp.pattern, ext: ext, total: Math.max(names.length, 1) });
    return namer(names[0] || 'Ahmad Fauzan', 1);
  }
  function updateExportInfo() {
    $('e-example').textContent = 'Contoh: ' + exampleName() + ' — ZIP: ' + CB.Export.zipNames(state.exp.zipName).file;
    $('e-res').textContent = state.img
      ? 'Resolusi output: ' + imgW() + ' × ' + imgH() + ' px (asli, tidak diturunkan).'
      : 'Resolusi output mengikuti template asli.';
    $('e-quality-wrap').hidden = state.exp.format !== 'jpg';
    $('e-quality-val').textContent = String(state.exp.quality);
    document.querySelectorAll('#e-format .seg-btn').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.format === state.exp.format ? 'true' : 'false'); });
  }

  function bindExport() {
    $('e-pattern').value = state.exp.pattern; $('e-zip').value = state.exp.zipName; $('e-quality').value = String(state.exp.quality);
    document.querySelectorAll('#e-format .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { state.exp.format = b.dataset.format; persist(); updateExportInfo(); });
    });
    $('e-quality').addEventListener('input', function (e) { state.exp.quality = Number(e.target.value); persist(); updateExportInfo(); });
    $('e-pattern').addEventListener('input', function (e) { state.exp.pattern = e.target.value; persist(); updateExportInfo(); });
    $('e-zip').addEventListener('input', function (e) { state.exp.zipName = e.target.value; persist(); updateExportInfo(); });
    document.querySelectorAll('[data-token]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inp = $('e-pattern'), s = inp.selectionStart == null ? inp.value.length : inp.selectionStart, e = inp.selectionEnd == null ? s : inp.selectionEnd;
        inp.value = inp.value.slice(0, s) + b.dataset.token + inp.value.slice(e);
        inp.focus(); inp.setSelectionRange(s + b.dataset.token.length, s + b.dataset.token.length);
        state.exp.pattern = inp.value; persist(); updateExportInfo();
      });
    });
    document.querySelectorAll('[data-pattern]').forEach(function (b) {
      b.addEventListener('click', function () { $('e-pattern').value = b.dataset.pattern; state.exp.pattern = b.dataset.pattern; persist(); updateExportInfo(); });
    });
    $('e-generate').addEventListener('click', onGenerate);
  }

  /* ------------------------------------------------------- preview / status */
  function onDraw(L) {
    var d = state.design;
    var alignTxt = d.align === 'left' ? 'kiri' : d.align === 'right' ? 'kanan' : 'tengah';
    $('status-pos').textContent = 'X ' + d.x + ' · Y ' + d.y + ' px · anchor ' + alignTxt + ' / baseline';
    $('status-size').textContent = 'Font ' + (Math.round(L.size * 10) / 10) + ' px' + (L.shrunk ? ' (auto-fit dari ' + d.fontSize + ')' : '') + ' · lebar ' + Math.round(L.width) + ' / ' + d.maxWidth;
    var warn = $('status-warn'), msg = '';
    if (!L.fits) msg = d.autoFit ? 'Nama tidak muat walau sudah di ukuran minimum' : 'Nama melebihi lebar maksimum (aktifkan auto-fit atau perlebar)';
    else {
      var W = imgW(), H = imgH();
      var oob = CB.textCorners(d, L.box).some(function (c) { return c.x < -0.5 || c.y < -0.5 || c.x > W + 0.5 || c.y > H + 0.5; });
      if (oob) msg = 'Teks keluar dari area sertifikat';
    }
    warn.hidden = !msg; warn.textContent = msg;
    updatePnav();
  }

  function updatePnav() {
    var n = P.count(), pn = $('pnav');
    pn.hidden = state.previewMode !== 'participant';
    var label = $('pnav-label');
    if (!n) { label.textContent = 'Belum ada peserta'; label.title = ''; }
    else {
      var i = clamp(state.previewIndex, 0, n - 1);
      var nm = P.getAll()[i].name;
      label.textContent = 'Peserta ' + (i + 1) + ' dari ' + n + ': ' + nm; label.title = nm;
    }
    $('prev-btn').disabled = !n || state.previewIndex <= 0;
    $('next-btn').disabled = !n || state.previewIndex >= n - 1;
  }

  function setMode(m) {
    state.previewMode = m;
    if (m === 'participant') state.previewed = true;
    $('mode-design').setAttribute('aria-pressed', m === 'design' ? 'true' : 'false');
    $('mode-participant').setAttribute('aria-pressed', m === 'participant' ? 'true' : 'false');
    if (m === 'participant' && !P.count()) toast('Belum ada peserta. Tambahkan peserta untuk pratinjau per nama.', 'info');
    updatePnav(); Editor.redraw(); refresh();
  }
  function stepPreview(delta) {
    var n = P.count(); if (!n) return;
    state.previewIndex = clamp(state.previewIndex + delta, 0, n - 1);
    state.previewed = true;
    P.setActive(state.previewIndex);
    updatePnav(); Editor.redraw(); checkFont(); refresh();
  }

  function bindToolbar() {
    $('mode-design').addEventListener('click', function () { setMode('design'); });
    $('mode-participant').addEventListener('click', function () { setMode('participant'); });
    $('prev-btn').addEventListener('click', function () { stepPreview(-1); });
    $('next-btn').addEventListener('click', function () { stepPreview(1); });
    $('zoom-in').addEventListener('click', function () { Editor.zoomBy(1.25); });
    $('zoom-out').addEventListener('click', function () { Editor.zoomBy(1 / 1.25); });
    $('zoom-label').addEventListener('click', function () { Editor.setZoom('fit'); });
    $('zoom-100').addEventListener('click', function () { Editor.setZoom(1); });
    $('guides-btn').addEventListener('click', function (e) {
      state.guides = !state.guides; e.currentTarget.setAttribute('aria-pressed', String(state.guides)); Editor.redraw();
    });
  }

  /* ----------------------------------------------------------- readiness */
  function issues() {
    var a = [];
    if (!state.img) a.push({ msg: 'Unggah template sertifikat terlebih dahulu.', short: 'Template belum ada', view: 'template' });
    if (!P.count()) a.push({ msg: 'Tambahkan minimal satu peserta.', short: 'Peserta belum ada', view: 'participants' });
    var dv = CB.validateDesign(state.design);
    if (dv) a.push({ msg: 'Pengaturan teks tidak valid: ' + dv + '.', short: 'Pengaturan teks tidak valid', view: 'editor' });
    return a;
  }

  function refresh() {
    var n = P.count();
    var badge = $('nav-badge-participants'); badge.hidden = !n; badge.textContent = n > 999 ? '999+' : String(n);
    $('ab-count').textContent = n + ' peserta';
    var tDot = $('ab-template-dot'), tTxt = $('ab-template');
    if (state.img) { tDot.className = 'dot ok'; tTxt.textContent = 'Template siap · ' + imgW() + '×' + imgH(); }
    else { tDot.className = 'dot bad'; tTxt.textContent = 'Template belum diunggah'; }
    var iss = issues(), rDot = $('ab-ready-dot'), rTxt = $('ab-ready');
    if (!iss.length) { rDot.className = 'dot ok'; rTxt.textContent = 'Siap ekspor'; }
    else { rDot.className = 'dot pend'; rTxt.textContent = 'Belum siap: ' + iss[0].short; }

    function step(name, done) { var li = document.querySelector('.step[data-step="' + name + '"]'); if (li) li.classList.toggle('done', !!done); }
    step('template', !!state.img);
    step('design', !!state.img && !CB.validateDesign(state.design));
    step('participants', n > 0);
    step('preview', state.previewed && !!state.img && n > 0);
    step('export', state.generated);
    $('step-template-txt').textContent = state.img ? state.imgInfo.name : 'Belum ada template';
    $('step-participants-txt').textContent = n ? n + ' peserta' : 'Belum ada peserta';

    var info = $('template-info');
    info.hidden = !state.img;
    if (state.img) {
      $('tpl-name').textContent = state.imgInfo.name; $('tpl-name').title = state.imgInfo.name;
      $('tpl-dim').textContent = state.imgInfo.w + ' × ' + state.imgInfo.h + ' px';
      $('tpl-size').textContent = fmtBytes(state.imgInfo.size);
      $('tpl-type').textContent = state.imgInfo.type;
    }
    if (state.view === 'export') updateExportInfo();
  }

  /* -------------------------------------------------------- file routing */
  function routeFile(file) {
    if (!file) return;
    var name = file.name || '';
    if (/\.(png|jpe?g)$/i.test(name) || /^image\/(png|jpeg)$/.test(file.type)) return loadTemplateFile(file);
    if (/\.(txt|csv)$/i.test(name)) { showView('participants'); return P.importFile(file); }
    toast('Format file tidak didukung. Gunakan PNG/JPG untuk template, atau TXT/CSV untuk daftar peserta.', 'error');
  }

  function bindFiles() {
    var input = $('file-template');
    function openPicker() { input.value = ''; input.click(); }
    document.querySelectorAll('[data-dz]').forEach(function (z) {
      z.addEventListener('click', openPicker);
      z.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
    });
    $('tpl-replace').addEventListener('click', openPicker);
    $('tpl-remove').addEventListener('click', removeTemplate);
    input.addEventListener('change', function () { var f = input.files && input.files[0]; input.value = ''; if (f) loadTemplateFile(f); });

    var depth = 0, overlay = $('drop-overlay');
    overlay.textContent = 'Lepaskan file: gambar → template, .txt/.csv → peserta';
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
    window.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; overlay.hidden = false; });
    window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; overlay.hidden = true;
      var files = e.dataTransfer.files;
      if (!files || !files.length) return;
      if (files.length > 1) toast('Hanya file pertama yang digunakan.', 'info');
      routeFile(files[0]);
    });
  }

  /* ------------------------------------------------------------- generate */
  var genEl = {};
  function showGen() { genEl.panel.hidden = false; }

  function resetGenUI(total, desc) {
    genEl.title.textContent = 'Generating certificates...';
    genEl.sub.textContent = desc;
    genEl.fill.className = 'progress-fill'; genEl.fill.style.width = '0%';
    genEl.bar.setAttribute('aria-valuenow', '0');
    genEl.done.textContent = '0'; genEl.total.textContent = String(total); genEl.ok.textContent = '0'; genEl.fail.textContent = '0';
    genEl.errors.hidden = true; genEl.errList.textContent = '';
    genEl.cancel.hidden = false; genEl.cancel.disabled = false; genEl.cancel.textContent = 'Batalkan';
    genEl.details.hidden = true; genEl.download.hidden = true; genEl.close.hidden = true;
    showGen();
  }

  function onGenProgress(p) {
    var pct;
    if (p.phase === 'zip') {
      pct = Math.round(p.percent || 0);
      genEl.title.textContent = 'Menyusun file ZIP...';
      genEl.sub.textContent = 'Mengemas ' + p.ok + ' file — ' + pct + '%. Jangan tutup halaman ini.';
      genEl.cancel.hidden = true;
    } else {
      pct = p.total ? Math.floor(p.done / p.total * 100) : 0;
    }
    genEl.fill.style.width = pct + '%';
    genEl.bar.setAttribute('aria-valuenow', String(pct));
    genEl.done.textContent = String(p.done); genEl.total.textContent = String(p.total);
    genEl.ok.textContent = String(p.ok); genEl.fail.textContent = String(p.failed);
  }

  function fillErrors(list) {
    genEl.errList.textContent = '';
    list.slice(0, 200).forEach(function (f) {
      var li = document.createElement('li'); li.textContent = '#' + f.index + ' ' + f.name + ': ' + f.message; genEl.errList.appendChild(li);
    });
    if (list.length > 200) { var li = document.createElement('li'); li.textContent = '… dan ' + (list.length - 200) + ' error lainnya.'; genEl.errList.appendChild(li); }
  }

  function onGenFinish(res) {
    genEl.cancel.hidden = true; genEl.close.hidden = false;
    genEl.done.textContent = String(res.ok + res.failed.length); genEl.total.textContent = String(res.total);
    genEl.ok.textContent = String(res.ok); genEl.fail.textContent = String(res.failed.length);
    if (res.failed.length) { fillErrors(res.failed); genEl.details.hidden = false; }
    if (res.status === 'done') {
      state.lastResult = res; state.generated = true; state.downloaded = false;
      genEl.title.textContent = res.failed.length ? 'Selesai dengan beberapa kegagalan' : 'Selesai';
      genEl.sub.textContent = res.ok + ' dari ' + res.total + ' sertifikat berhasil dibuat' + (res.failed.length ? ', ' + res.failed.length + ' gagal' : '') + '. ' + res.filename + ' (' + fmtBytes(res.size) + ') siap diunduh.';
      genEl.fill.className = 'progress-fill ' + (res.failed.length ? 'fail' : 'done'); genEl.fill.style.width = '100%'; genEl.bar.setAttribute('aria-valuenow', '100');
      genEl.download.hidden = false; genEl.download.focus();
      toast('ZIP siap diunduh: ' + res.ok + ' sertifikat.', 'success');
      refresh();
    } else if (res.status === 'cancelled') {
      genEl.title.textContent = 'Dibatalkan';
      genEl.sub.textContent = 'Proses dibatalkan setelah ' + res.ok + ' sertifikat. File ZIP tidak dibuat.';
      genEl.fill.className = 'progress-fill fail';
    } else {
      genEl.title.textContent = 'Gagal';
      genEl.sub.textContent = res.message || 'Terjadi kesalahan.';
      genEl.fill.className = 'progress-fill fail';
      toast(res.message || 'Pembuatan sertifikat gagal.', 'error', { timeout: 10000 });
    }
  }

  async function overflowDialog(over) {
    var d = state.design;
    var shown = over.slice(0, 8).map(function (o) { return '#' + o.index + ' ' + o.name; });
    if (over.length > 8) shown.push('… dan ' + (over.length - 8) + ' nama lainnya');
    var text = d.autoFit
      ? over.length + ' nama tidak muat dalam lebar maksimum walau sudah dikecilkan ke ukuran minimum (' + d.minFontSize + ' px). Anda dapat memperlebar area teks atau menurunkan ukuran minimum, atau melanjutkan (nama tersebut akan melewati lebar maksimum).'
      : over.length + ' nama melebihi lebar maksimum karena auto-fit nonaktif. Aktifkan auto-fit, atau lanjutkan dengan ukuran font saat ini.';
    var actions = [{ label: 'Sesuaikan desain', value: 'cancel' }];
    if (!d.autoFit) actions.push({ label: 'Aktifkan auto-fit', kind: 'primary', value: 'autofit' });
    actions.push({ label: 'Lanjutkan tetap', kind: d.autoFit ? 'primary' : '', value: 'continue' });
    return modal({ title: 'Beberapa nama terlalu panjang', body: text, list: shown, actions: actions, dismissValue: 'cancel' });
  }

  async function onGenerate() {
    if (CB.Generator.running) {
      toast('Proses pembuatan sertifikat masih berjalan. Tunggu hingga selesai atau batalkan terlebih dahulu.', 'warn'); showGen(); return;
    }
    var iss = issues();
    if (iss.length) { toast(iss[0].msg, 'error'); showView(iss[0].view); return; }
    if (state.exp.format === 'jpg' && !(state.exp.quality >= 50 && state.exp.quality <= 100)) { toast('Kualitas JPG harus antara 50 dan 100.', 'error'); showView('export'); return; }
    if (state.lastResult && !state.downloaded) {
      var ok0 = await confirmDialog('Buang ZIP sebelumnya?', 'ZIP dari proses sebelumnya belum diunduh dan akan dibuang jika Anda membuat yang baru.', { confirmLabel: 'Buang & generate ulang', danger: true });
      if (!ok0) { showGen(); return; }
    }

    var names = P.names();
    var av = await CB.ensureFont(state.design, names.slice(0, 200).join(' '));
    if (!av.available) {
      var ok1 = await confirmDialog('Font tidak tersedia', 'Font “' + state.design.fontFamily + '” tidak ditemukan. Sertifikat akan dibuat dengan font cadangan. Lanjutkan?', { confirmLabel: 'Lanjutkan' });
      if (!ok1) { showView('editor'); return; }
    }

    var over = CB.findOverflows(names, state.design);
    while (over.length) {
      var choice = await overflowDialog(over);
      if (choice === 'cancel') { showView('editor'); return; }
      if (choice === 'autofit') { state.design.autoFit = true; designChanged(); over = CB.findOverflows(names, state.design); continue; }
      break;
    }

    state.lastResult = null;
    var job = {
      img: state.img, names: names, design: clone(state.design),
      format: state.exp.format, quality: state.exp.quality / 100,
      pattern: state.exp.pattern, zipName: state.exp.zipName
    };
    resetGenUI(names.length, names.length + ' sertifikat · ' + imgW() + '×' + imgH() + ' px · ' + state.exp.format.toUpperCase());
    CB.Generator.run(job, { onProgress: onGenProgress, onFinish: onGenFinish });
  }

  function bindGen() {
    genEl = {
      panel: $('gen-panel'), title: $('gen-title'), sub: $('gen-sub'), bar: $('gen-bar'), fill: $('gen-fill'),
      done: $('gen-done'), total: $('gen-total'), ok: $('gen-ok'), fail: $('gen-fail'),
      errors: $('gen-errors'), errList: $('gen-error-list'),
      cancel: $('gen-cancel'), details: $('gen-details'), download: $('gen-download'), close: $('gen-close')
    };
    genEl.cancel.addEventListener('click', function () { CB.Generator.cancel(); genEl.cancel.disabled = true; genEl.cancel.textContent = 'Membatalkan…'; });
    genEl.details.addEventListener('click', function () { genEl.errors.hidden = !genEl.errors.hidden; });
    genEl.download.addEventListener('click', function () {
      if (!state.lastResult) return;
      CB.Export.saveBlob(state.lastResult.blob, state.lastResult.filename);
      state.downloaded = true;
    });
    genEl.close.addEventListener('click', async function () {
      if (state.lastResult && !state.downloaded) {
        var ok = await confirmDialog('Tutup tanpa mengunduh?', 'ZIP belum diunduh. Jika ditutup, hasil ini dibuang dan Anda perlu generate ulang.', { confirmLabel: 'Tutup & buang', danger: true });
        if (!ok) return;
      }
      state.lastResult = null; genEl.panel.hidden = true;
    });
    $('generate-btn').addEventListener('click', onGenerate);
    window.addEventListener('beforeunload', function (e) {
      if (CB.Generator.running || (state.lastResult && !state.downloaded)) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* -------------------------------------------------------------- settings */
  async function resetSettings() {
    var ok = await confirmDialog('Reset pengaturan?', 'Posisi, font, warna, dan pengaturan ekspor dikembalikan ke bawaan. Template dan daftar peserta tidak dihapus.', { confirmLabel: 'Reset', danger: true });
    if (!ok) return;
    state.design = clone(DEFAULT_DESIGN); state.exp = clone(DEFAULT_EXPORT);
    state.projectName = 'Proyek Sertifikat'; state.sampleName = 'Nama Peserta'; state.templateSize = null;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    if (state.img) adaptDesignToTemplate(imgW(), imgH());
    $('e-pattern').value = state.exp.pattern; $('e-zip').value = state.exp.zipName; $('e-quality').value = String(state.exp.quality);
    syncControls(); updateExportInfo(); Editor.redraw(); scheduleTable(); refresh(); checkFont(); persist();
    toast('Pengaturan dikembalikan ke bawaan.', 'success');
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    P = CB.Participants; Editor = CB.Editor;
    loadSettings();

    Editor.init({
      state: state,
      hooks: {
        onDraw: onDraw,
        onMove: function (final) { syncControls(); if (final) { persist(); } scheduleTable(); },
        onZoom: function (scale, isFit) { $('zoom-label').textContent = (isFit ? 'Fit · ' : '') + Math.round(scale * 100) + '%'; }
      }
    });

    P.fitCheck = function (name) { return CB.measureLayout(name, state.design); };
    P.onChange = function () {
      var n = P.count();
      state.previewIndex = n ? clamp(state.previewIndex, 0, n - 1) : 0;
      refresh(); updatePnav(); Editor.redraw();
      if (state.view === 'export') updateExportInfo();
    };
    P.onPick = function (idx) { state.previewIndex = idx; state.previewed = true; setMode('participant'); };
    P.init();

    bindControls(); bindExport(); bindToolbar(); bindFiles(); bindGen();

    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () {
        var panel = $('panel');
        if (isMobile() && state.view === b.dataset.view && panel.classList.contains('open')) { panel.classList.remove('open'); return; }
        showView(b.dataset.view);
      });
    });
    document.querySelectorAll('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { showView(b.dataset.goto); }); });
    $('goto-preview').addEventListener('click', function () {
      if (!P.count()) { toast('Tambahkan peserta terlebih dahulu untuk pratinjau per nama.', 'info'); showView('participants'); return; }
      setMode('participant'); if (isMobile()) $('panel').classList.remove('open');
    });
    $('panel-close').addEventListener('click', function () { $('panel').classList.remove('open'); });
    $('s-project').addEventListener('input', function (e) { state.projectName = e.target.value; document.title = (state.projectName ? state.projectName + ' — ' : '') + 'CertiBulk'; persist(); });
    $('s-reset').addEventListener('click', resetSettings);

    showView('workspace', { open: false });
    syncControls(); updateExportInfo(); refresh(); updatePnav();
    checkFont();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { Editor.redraw(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
