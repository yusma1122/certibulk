/* CertiBulk — rendering core (shared by preview AND export) + bulk generator */
(function () {
  'use strict';
  var CB = (window.CB = window.CB || {});

  /* ---------------------------------------------------------------- fonts */
  CB.FONTS = [
    { id: 'Arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif', local: false, weights: [400, 700] },
    { id: 'Georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif', local: false, weights: [400, 700] },
    { id: 'Times New Roman', label: 'Times New Roman', stack: '"Times New Roman", Times, serif', local: false, weights: [400, 700] },
    { id: 'Poppins', label: 'Poppins', stack: '"Poppins", sans-serif', local: true, weights: [400, 700] },
    { id: 'Montserrat', label: 'Montserrat', stack: '"Montserrat", sans-serif', local: true, weights: [400, 700] },
    { id: 'Playfair Display', label: 'Playfair Display', stack: '"Playfair Display", serif', local: true, weights: [400, 700] },
    { id: 'Great Vibes', label: 'Great Vibes', stack: '"Great Vibes", cursive', local: true, weights: [400] },
    { id: 'Inter', label: 'Inter', stack: '"Inter", sans-serif', local: true, weights: [400, 700] }
  ];

  CB.fontById = function (id) {
    for (var i = 0; i < CB.FONTS.length; i++) if (CB.FONTS[i].id === id) return CB.FONTS[i];
    return CB.FONTS[0];
  };

  CB.effectiveWeight = function (d) {
    var f = CB.fontById(d.fontFamily);
    return f.weights.indexOf(Number(d.fontWeight)) >= 0 ? Number(d.fontWeight) : f.weights[0];
  };

  CB.fontString = function (d, size) {
    var f = CB.fontById(d.fontFamily);
    return (d.italic ? 'italic ' : '') + CB.effectiveWeight(d) + ' ' + size + 'px ' + f.stack;
  };

  var sysCache = Object.create(null);
  function systemFontPresent(family) {
    if (family in sysCache) return sysCache[family];
    var ctx = document.createElement('canvas').getContext('2d');
    var text = 'mmmmmmmmmmlliWQ@#0123';
    var present = false;
    var bases = ['monospace', 'serif', 'sans-serif'];
    for (var i = 0; i < bases.length && !present; i++) {
      ctx.font = '72px ' + bases[i];
      var w0 = ctx.measureText(text).width;
      ctx.font = '72px "' + family + '", ' + bases[i];
      if (ctx.measureText(text).width !== w0) present = true;
    }
    sysCache[family] = present;
    return present;
  }

  /** Loads the font (if bundled) and reports whether it is really available. */
  CB.ensureFont = function (d, text) {
    var f = CB.fontById(d.fontFamily);
    var spec = CB.fontString(d, 40);
    var p = (document.fonts && document.fonts.load)
      ? document.fonts.load(spec, text || 'Aa').catch(function () { return []; })
      : Promise.resolve([]);
    return p.then(function () {
      if (f.local) {
        var ok = false;
        if (document.fonts && document.fonts.forEach) {
          document.fonts.forEach(function (face) {
            var fam = String(face.family).replace(/["']/g, '');
            if (fam === f.id && face.status === 'loaded') ok = true;
          });
        } else { ok = true; }
        return { id: f.id, available: ok, local: true };
      }
      return { id: f.id, available: systemFontPresent(f.id), local: false };
    });
  };

  /* -------------------------------------------------------------- measure */
  var seg = null;
  function graphemes(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      if (!seg) seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      var out = [];
      var it = seg.segment(text)[Symbol.iterator]();
      for (var n = it.next(); !n.done; n = it.next()) out.push(n.value.segment);
      return out;
    }
    return Array.from(text);
  }

  CB.measureText = function (ctx, text, ls) {
    if (!ls) return ctx.measureText(text).width;
    var g = graphemes(text), w = 0;
    for (var i = 0; i < g.length; i++) w += ctx.measureText(g[i]).width;
    return w + ls * Math.max(0, g.length - 1);
  };

  /** Decides font size (auto-fit) and measures. Pure function of (text, design) + a canvas context. */
  CB.computeLayout = function (ctx, text, d) {
    var maxW = d.maxWidth;
    var size = d.fontSize;
    var min = Math.min(d.minFontSize || 8, d.fontSize);
    function widthAt(s) { ctx.font = CB.fontString(d, s); return CB.measureText(ctx, text, d.letterSpacing); }
    var w = widthAt(size);
    var fits = w <= maxW + 0.01;
    var shrunk = false;
    if (!fits && d.autoFit) {
      shrunk = true;
      if (widthAt(min) > maxW) {
        size = min; w = widthAt(min); fits = false;
      } else {
        var lo = min, hi = size;
        for (var i = 0; i < 22; i++) {
          var mid = (lo + hi) / 2;
          if (widthAt(mid) <= maxW) lo = mid; else hi = mid;
        }
        size = Math.floor(lo * 100) / 100;
        w = widthAt(size);
        fits = w <= maxW + 0.01;
      }
    }
    ctx.font = CB.fontString(d, size);
    return { size: size, width: w, fits: fits, shrunk: shrunk, font: ctx.font, text: text };
  };

  /** Draws only the name (translate to anchor, rotate, align). Returns layout incl. local bounding box. */
  CB.drawName = function (ctx, text, d) {
    var L = CB.computeLayout(ctx, text, d);
    var w = L.width;
    var startX = d.align === 'center' ? -w / 2 : d.align === 'right' ? -w : 0;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate((d.rotation || 0) * Math.PI / 180);
    ctx.font = CB.fontString(d, L.size);
    ctx.fillStyle = d.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if (text) {
      if (!d.letterSpacing) {
        ctx.fillText(text, startX, 0);
      } else {
        var g = graphemes(text), x = startX;
        for (var i = 0; i < g.length; i++) {
          ctx.fillText(g[i], x, 0);
          x += ctx.measureText(g[i]).width + d.letterSpacing;
        }
      }
    }
    var m = ctx.measureText(text || 'Hg');
    ctx.restore();
    var asc = Math.max(m.actualBoundingBoxAscent || 0, L.size * 0.72);
    var desc = Math.max(m.actualBoundingBoxDescent || 0, L.size * 0.22);
    L.box = { x: startX, y: -asc, w: w, h: asc + desc };
    return L;
  };

  /** Template + name. The ONE function used for preview, overflow checks and export. */
  CB.renderCertificate = function (ctx, img, name, d, opts) {
    opts = opts || {};
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, W, H); }
    ctx.drawImage(img, 0, 0, W, H);
    ctx.restore();
    return CB.drawName(ctx, name, d);
  };

  /** Corners of the rotated text box in image coordinates. */
  CB.textCorners = function (d, box) {
    var r = (d.rotation || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]]
      .map(function (p) { return { x: d.x + p[0] * c - p[1] * s, y: d.y + p[0] * s + p[1] * c }; });
  };

  var mctx = null;
  function measureCtx() {
    if (!mctx) { var c = document.createElement('canvas'); c.width = 1; c.height = 1; mctx = c.getContext('2d'); }
    return mctx;
  }
  CB.measureLayout = function (name, d) { return CB.computeLayout(measureCtx(), name, d); };

  /** Names that do not fit even after auto-fit (or any overflow when auto-fit is off). */
  CB.findOverflows = function (names, d) {
    var out = [], ctx = measureCtx();
    for (var i = 0; i < names.length; i++) {
      var L = CB.computeLayout(ctx, names[i], d);
      if (!L.fits) out.push({ index: i + 1, name: names[i], width: L.width, size: L.size });
    }
    return out;
  };

  /** Basic design validation. Returns an error string or ''. */
  CB.validateDesign = function (d) {
    var nums = ['x', 'y', 'fontSize', 'maxWidth', 'rotation', 'letterSpacing', 'minFontSize'];
    for (var i = 0; i < nums.length; i++) if (!isFinite(d[nums[i]])) return 'Nilai ' + nums[i] + ' tidak valid';
    if (d.fontSize <= 0) return 'Font size harus lebih dari 0';
    if (d.maxWidth <= 0) return 'Lebar maksimum harus lebih dari 0';
    if (!/^#[0-9a-fA-F]{6}$/.test(d.color)) return 'Warna teks tidak valid';
    return '';
  };

  /* ------------------------------------------------------------ generator */
  function yieldToUI() {
    return new Promise(function (resolve) {
      if (document.hidden) {
        var ch = new MessageChannel();
        ch.port1.onmessage = function () { ch.port1.close(); resolve(); };
        ch.port2.postMessage(0);
      } else {
        requestAnimationFrame(function () { setTimeout(resolve, 0); });
      }
    });
  }

  CB.Generator = {
    running: false,
    cancelRequested: false,
    cancel: function () { this.cancelRequested = true; },

    /**
     * @param {object} job {img, names[], design, format, quality(0-1), pattern, zipName}
     * @param {object} cb  {onProgress(p), onFinish(result)}
     */
    run: function (job, cb) {
      var self = this;
      if (self.running) return Promise.reject(new Error('Proses lain masih berjalan'));
      self.running = true; self.cancelRequested = false;

      var img = job.img, names = job.names, design = job.design;
      var total = names.length;
      var failed = [];
      var ok = 0;
      var lastUI = 0;

      function progress(extra) {
        var p = { done: ok + failed.length, total: total, ok: ok, failed: failed.length, phase: 'render' };
        for (var k in extra) p[k] = extra[k];
        cb.onProgress(p);
      }

      function finish(result) {
        self.running = false;
        cb.onFinish(result);
        return result;
      }

      return (async function () {
        if (typeof JSZip === 'undefined') {
          return finish({ status: 'error', message: 'Library JSZip tidak termuat. Pastikan assets/vendor/jszip.min.js tersedia.', ok: 0, failed: failed, total: total });
        }
        var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
        var canvas, ctx;
        try {
          canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas 2D tidak tersedia');
        } catch (e) {
          return finish({ status: 'error', message: 'Canvas gagal dibuat untuk ukuran ' + W + '×' + H + ': ' + (e.message || e), ok: 0, failed: failed, total: total });
        }

        try { await CB.ensureFont(design, names.slice(0, 200).join(' ')); } catch (e) { /* fall back silently */ }

        var format = job.format === 'jpg' ? 'jpg' : 'png';
        var mime = CB.Export.mimeFor(format);
        var quality = format === 'jpg' ? job.quality : undefined;
        var zipInfo = CB.Export.zipNames(job.zipName);
        var namer = CB.Export.makeNamer({ pattern: job.pattern, ext: CB.Export.extFor(format), total: total });
        var zip = new JSZip();
        var folder = zip.folder(zipInfo.folder);
        var consecutive = 0;
        var aborted = '';

        progress({});
        for (var i = 0; i < total; i++) {
          if (self.cancelRequested) break;
          var name = names[i];
          try {
            CB.renderCertificate(ctx, img, name, design, { background: format === 'jpg' ? '#ffffff' : null });
            var blob = await CB.Export.canvasToBlob(canvas, mime, quality);
            folder.file(namer(name, i + 1), blob, { binary: true });
            ok++; consecutive = 0;
          } catch (err) {
            failed.push({ index: i + 1, name: name, message: (err && err.message) || String(err) });
            consecutive++;
            if (consecutive >= 5) {
              aborted = 'Proses dihentikan setelah 5 kegagalan berturut-turut. Kemungkinan memori browser habis: kecilkan resolusi template, pilih JPG, atau generate dalam beberapa kelompok peserta.';
              break;
            }
          }
          var now = performance.now();
          if (now - lastUI > 90 || i === total - 1) { progress({}); }
          if (now - lastUI > 50) { await yieldToUI(); lastUI = performance.now(); }
        }

        if (self.cancelRequested) {
          return finish({ status: 'cancelled', ok: ok, failed: failed, total: total });
        }
        if (aborted) {
          return finish({ status: 'error', message: aborted, ok: ok, failed: failed, total: total });
        }
        if (ok === 0) {
          return finish({ status: 'error', message: 'Tidak ada sertifikat yang berhasil dibuat.', ok: 0, failed: failed, total: total });
        }

        progress({ phase: 'zip', percent: 0 });
        var zipBlob;
        try {
          zipBlob = await zip.generateAsync(
            { type: 'blob', compression: 'STORE', streamFiles: true },
            function (meta) { progress({ phase: 'zip', percent: meta.percent }); }
          );
        } catch (err) {
          return finish({ status: 'error', message: 'ZIP gagal dibuat: ' + ((err && err.message) || err) + '. Coba kurangi jumlah peserta atau pilih format JPG.', ok: ok, failed: failed, total: total });
        }
        return finish({ status: 'done', blob: zipBlob, filename: zipInfo.file, ok: ok, failed: failed, total: total, size: zipBlob.size });
      })().catch(function (err) {
        return finish({ status: 'error', message: 'Terjadi kesalahan tak terduga: ' + ((err && err.message) || err), ok: ok, failed: failed, total: total });
      });
    }
  };
})();
