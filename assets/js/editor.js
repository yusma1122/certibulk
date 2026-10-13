/* CertiBulk — visual editor: preview canvas, zoom, drag & drop, keyboard nudging */
(function () {
  'use strict';
  var CB = (window.CB = window.CB || {});
  var Editor = (CB.Editor = {});

  var canvas, ctx, stage, holder, state;
  var img = null;
  var raf = 0;
  var selected = true;
  var dragging = null;
  var lastLayout = null;
  var scale = 1;
  var hooks = { onDraw: function () {}, onMove: function () {}, onZoom: function () {} };

  Editor.init = function (opts) {
    state = opts.state;
    for (var k in opts.hooks) hooks[k] = opts.hooks[k];
    canvas = document.getElementById('cert-canvas');
    ctx = canvas.getContext('2d');
    stage = document.getElementById('stage');
    holder = document.getElementById('canvas-holder');

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('keydown', onKey);
    canvas.addEventListener('focus', function () { selected = true; Editor.redraw(); });

    if (window.ResizeObserver) {
      new ResizeObserver(function () { if (img && state.zoom === 'fit') { applyScale(); Editor.redraw(); } }).observe(stage);
    } else {
      window.addEventListener('resize', function () { if (img && state.zoom === 'fit') { applyScale(); Editor.redraw(); } });
    }
  };

  /* ---- image / zoom ---- */
  Editor.setImage = function (image) {
    img = image;
    holder.hidden = !img;
    document.getElementById('empty-state').hidden = !!img;
    if (img) {
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      applyScale();
      Editor.redrawNow();
    } else {
      lastLayout = null;
    }
  };

  function applyScale() {
    if (!img) return;
    var W = canvas.width, H = canvas.height;
    if (state.zoom === 'fit') {
      var sw = stage.clientWidth - 48, sh = stage.clientHeight - 48;
      scale = Math.min(sw / W, sh / H);
      if (!isFinite(scale) || scale <= 0) scale = 0.1;
      scale = Math.min(scale, 4);
    } else {
      scale = state.zoom;
    }
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
    hooks.onZoom(scale, state.zoom === 'fit');
  }

  Editor.getScale = function () { return scale; };
  Editor.setZoom = function (z) {
    state.zoom = z === 'fit' ? 'fit' : Math.max(0.05, Math.min(8, z));
    applyScale();
    Editor.redraw();
  };
  Editor.zoomBy = function (factor) { Editor.setZoom(scale * factor); };
  Editor.getLayout = function () { return lastLayout; };

  /* ---- drawing ---- */
  Editor.previewText = function () {
    if (state.previewMode === 'participant') {
      var list = CB.Participants.getAll();
      if (list.length) {
        var i = Math.max(0, Math.min(state.previewIndex, list.length - 1));
        return list[i].name;
      }
    }
    return state.sampleName || 'Nama Peserta';
  };

  Editor.redraw = function () {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; Editor.redrawNow(); });
  };

  Editor.redrawNow = function () {
    if (!img) return;
    var text = Editor.previewText();
    lastLayout = CB.renderCertificate(ctx, img, text, state.design, {});
    if (state.guides) drawOverlay();
    hooks.onDraw(lastLayout, text);
  };

  function drawOverlay() {
    var d = state.design, L = lastLayout, s = Math.max(scale, 0.01);
    var box = L.box, pad = 6 / s;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate((d.rotation || 0) * Math.PI / 180);

    // maximum width guide
    var mx0 = d.align === 'center' ? -d.maxWidth / 2 : d.align === 'right' ? -d.maxWidth : 0;
    ctx.setLineDash([8 / s, 6 / s]);
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = L.fits ? 'rgba(79,70,229,0.55)' : 'rgba(220,38,38,0.95)';
    ctx.strokeRect(mx0, box.y - pad * 2, d.maxWidth, box.h + pad * 4);
    ctx.setLineDash([]);

    // selection bounding box
    if (selected || !L.fits) {
      ctx.lineWidth = 2 / s;
      ctx.strokeStyle = L.fits ? '#4F46E5' : '#DC2626';
      ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
      var hs = 7 / s;
      ctx.fillStyle = '#ffffff';
      var corners = [[box.x - pad, box.y - pad], [box.x + box.w + pad, box.y - pad], [box.x + box.w + pad, box.y + box.h + pad], [box.x - pad, box.y + box.h + pad]];
      for (var i = 0; i < corners.length; i++) {
        ctx.fillRect(corners[i][0] - hs / 2, corners[i][1] - hs / 2, hs, hs);
        ctx.strokeRect(corners[i][0] - hs / 2, corners[i][1] - hs / 2, hs, hs);
      }
    }

    // anchor crosshair (horizontal anchor + baseline)
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = '#4F46E5';
    var c = 11 / s;
    ctx.beginPath();
    ctx.moveTo(-c, 0); ctx.lineTo(c, 0);
    ctx.moveTo(0, -c); ctx.lineTo(0, c);
    ctx.stroke();
    ctx.fillStyle = '#4F46E5';
    ctx.beginPath(); ctx.arc(0, 0, 3 / s, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ---- pointer interaction ---- */
  function toImage(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
  }

  function hit(p) {
    if (!lastLayout) return false;
    var d = state.design, box = lastLayout.box;
    var r = -(d.rotation || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    var dx = p.x - d.x, dy = p.y - d.y;
    var lx = dx * c - dy * s, ly = dx * s + dy * c;
    var pad = 18 / Math.max(scale, 0.01);
    return lx >= box.x - pad && lx <= box.x + box.w + pad && ly >= box.y - pad && ly <= box.y + box.h + pad;
  }

  function onDown(e) {
    if (!img) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var p = toImage(e);
    if (hit(p)) {
      dragging = { dx: state.design.x - p.x, dy: state.design.y - p.y, id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      canvas.classList.add('dragging');
      selected = true;
      canvas.focus({ preventScroll: true });
      e.preventDefault();
      Editor.redraw();
    } else {
      selected = false;
      Editor.redraw();
    }
  }

  function onMove(e) {
    if (!img) return;
    var p = toImage(e);
    if (dragging) {
      var d = state.design;
      d.x = Math.round(Math.max(0, Math.min(canvas.width, p.x + dragging.dx)));
      d.y = Math.round(Math.max(0, Math.min(canvas.height, p.y + dragging.dy)));
      hooks.onMove(false);
      Editor.redraw();
    } else {
      canvas.classList.toggle('can-grab', hit(p));
    }
  }

  function onUp(e) {
    if (!dragging) return;
    try { canvas.releasePointerCapture(dragging.id); } catch (err) { /* ignore */ }
    dragging = null;
    canvas.classList.remove('dragging');
    hooks.onMove(true);
    Editor.redraw();
  }

  function onKey(e) {
    if (!img) return;
    var step = e.shiftKey ? 10 : 1, dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    var d = state.design;
    d.x = Math.round(Math.max(0, Math.min(canvas.width, d.x + dx)));
    d.y = Math.round(Math.max(0, Math.min(canvas.height, d.y + dy)));
    hooks.onMove(true);
    Editor.redraw();
  }
})();
