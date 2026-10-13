/* CertiBulk — export helpers: filenames, blobs, download */
(function () {
  'use strict';
  var CB = (window.CB = window.CB || {});

  var INVALID = /[\\\/:*?"<>|\u0000-\u001f\u007f]/g;
  var RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function truncate(str, max) {
    var a = Array.from(str);
    return a.length > max ? a.slice(0, max).join('') : str;
  }

  /** Clean a participant name so it is safe inside a file name. The name drawn on the certificate is never touched. */
  function sanitizeSegment(str, maxLen) {
    var s = String(str == null ? '' : str).normalize('NFC')
      .replace(INVALID, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._]+|[._]+$/g, '');
    s = truncate(s, maxLen || 80).replace(/[._]+$/, '');
    if (!s) s = 'tanpa_nama';
    if (RESERVED.test(s)) s = '_' + s;
    return s;
  }

  function extFor(format) { return format === 'jpg' ? '.jpg' : '.png'; }
  function mimeFor(format) { return format === 'jpg' ? 'image/jpeg' : 'image/png'; }

  /**
   * Returns a function (name, index1Based) -> unique file name (with extension).
   * Duplicates (case-insensitive) get _2, _3 ... so nothing is overwritten.
   */
  function makeNamer(opts) {
    var pattern = (opts.pattern && String(opts.pattern).trim()) || 'Sertifikat_{name}';
    var ext = opts.ext || '.png';
    var pad = Math.max(3, String(opts.total || 0).length);
    var used = Object.create(null);
    return function (name, index) {
      var base = pattern
        .replace(/\{index\}/gi, String(index).padStart(pad, '0'))
        .replace(/\{name\}/gi, function () { return sanitizeSegment(name); });
      base = base.replace(INVALID, '').replace(/\s+/g, '_');
      base = truncate(base, 150).replace(/[. ]+$/, '').replace(/^[. ]+/, '');
      if (!base) base = 'sertifikat_' + String(index).padStart(pad, '0');
      if (RESERVED.test(base)) base = '_' + base;
      var candidate = base, n = 1;
      while (used[(candidate + ext).toLowerCase()]) { n++; candidate = base + '_' + n; }
      used[(candidate + ext).toLowerCase()] = true;
      return candidate + ext;
    };
  }

  /** "My ZIP.zip" -> { file: "My_ZIP.zip", folder: "My_ZIP" } */
  function zipNames(input) {
    var raw = String(input == null ? '' : input).trim().replace(/\.zip$/i, '');
    var base = sanitizeSegment(raw || 'CertiBulk_Certificates', 100);
    return { file: base + '.zip', folder: base };
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (b) {
          if (b) resolve(b);
          else reject(new Error('Browser gagal mengonversi canvas ke gambar (kemungkinan memori tidak cukup atau gambar terlalu besar).'));
        }, mime, quality);
      } catch (e) { reject(e); }
    });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  CB.Export = {
    sanitizeSegment: sanitizeSegment,
    extFor: extFor,
    mimeFor: mimeFor,
    makeNamer: makeNamer,
    zipNames: zipNames,
    canvasToBlob: canvasToBlob,
    saveBlob: saveBlob
  };
})();
