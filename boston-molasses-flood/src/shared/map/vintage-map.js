/* VintageMap - stylised, deterministic, time-driven SVG map.
 * All geography comes from the config object. render(t) is a pure function of t (seconds).
 * Usage: const m = VintageMap.create(el, config); m.render(3.2); m.play(); */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VintageMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var THEMES = {
    paper: { bg: '#e8d9b5', bg2: '#cfb98a', street: '#6b5a3c', streetMinor: '#8a7650', water: '#b9c4b0', park: '#c9cf9e',
      ink: '#3b2f1d', route: '#9b2a1d', marker: '#9b2a1d', frame: '#3b2f1d', label: '#3b2f1d', grain: 0.35 },
    ink: { bg: '#10151c', bg2: '#05080c', street: '#7a8fa6', streetMinor: '#47586b', water: '#12202e', park: '#16261f',
      ink: '#c9d6e3', route: '#ffb454', marker: '#ffb454', frame: '#7a8fa6', label: '#c9d6e3', grain: 0.15 }
  };
  var FONT = "Georgia, 'Times New Roman', serif";

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(u) { return u * u * (3 - 2 * u); }            // smoothstep
  function d(points) { return points.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' '); }
  // Seeded PRNG so any jitter is deterministic.
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function cameraAt(cam, t, w, h) {
    if (!cam || !cam.length) return { x: w / 2, y: h / 2, zoom: 1 };
    if (t <= cam[0].t) return cam[0];
    var last = cam[cam.length - 1];
    if (t >= last.t) return last;
    for (var i = 0; i < cam.length - 1; i++) {
      var a = cam[i], b = cam[i + 1];
      if (t >= a.t && t <= b.t) {
        var u = ease((t - a.t) / (b.t - a.t || 1));
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, zoom: a.zoom + (b.zoom - a.zoom) * u };
      }
    }
    return last;
  }

  function create(container, config, opts) {
    opts = opts || {};
    var W = config.width || 1280, H = config.height || 720;
    var th = THEMES[opts.theme || config.theme] || THEMES.paper;
    var uid = 'vm' + Math.floor(rng(W * 7 + H)() * 1e6);
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: '100%', role: 'img',
      'aria-label': config.title || 'map', preserveAspectRatio: 'xMidYMid slice' });
    svg.style.display = 'block';
    var defs = el('defs', {}, svg);
    var g = el('radialGradient', { id: uid + 'bg', cx: '50%', cy: '50%', r: '75%' }, defs);
    el('stop', { offset: '0', 'stop-color': th.bg }, g); el('stop', { offset: '1', 'stop-color': th.bg2 }, g);
    var f = el('filter', { id: uid + 'grain', x: '0', y: '0', width: '100%', height: '100%' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.8', numOctaves: '2', seed: '7', result: 'n' }, f);
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 -0.35' }, f);
    var cp = el('clipPath', { id: uid + 'clip' }, defs);
    el('rect', { x: 28, y: 28, width: W - 56, height: H - 56 }, cp);

    el('rect', { width: W, height: H, fill: 'url(#' + uid + 'bg)' }, svg);
    var clipped = el('g', { 'clip-path': 'url(#' + uid + 'clip)' }, svg);
    var cam = el('g', {}, clipped);

    // Water & parks
    if (config.water) {
      el('path', { d: d(config.water.polygon) + 'Z', fill: th.water, stroke: th.streetMinor, 'stroke-width': 1.5 }, cam);
      // hatch lines, deterministic
      var r = rng(11), hatch = el('g', { stroke: th.streetMinor, 'stroke-width': 0.8, opacity: 0.5 }, cam);
      for (var i = 0; i < 40; i++) {
        var hx = r() * W, hy = 560 + r() * 150;
        el('path', { d: 'M' + hx + ' ' + hy + ' h' + (14 + r() * 20) }, hatch);
      }
    }
    (config.parks || []).forEach(function (p) {
      el('rect', { x: p.rect[0], y: p.rect[1], width: p.rect[2], height: p.rect[3], fill: th.park,
        stroke: th.streetMinor, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, cam);
      var t = el('text', { x: p.rect[0] + p.rect[2] / 2, y: p.rect[1] + p.rect[3] / 2, 'text-anchor': 'middle',
        'font-family': FONT, 'font-size': 12, 'font-style': 'italic', fill: th.label, opacity: 0.8 }, cam);
      t.textContent = p.label;
    });

    // Streets (casing + fill gives a printed-map look)
    var sg = el('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, cam);
    (config.streets || []).forEach(function (s) {
      var w = (s.weight || 2) * 2.2;
      el('path', { d: d(s.points), stroke: th.bg2, 'stroke-width': w + 3, opacity: 0.8 }, sg);
      el('path', { d: d(s.points), stroke: s.weight >= 3 ? th.street : th.streetMinor, 'stroke-width': w * 0.65 }, sg);
    });
    // Street labels along path (textPath)
    var lg = el('g', { 'font-family': FONT, fill: th.label }, cam);
    (config.streets || []).forEach(function (s, i) {
      if (!s.label) return;
      var id = uid + 'sp' + i;
      var pts = s.points[0][0] <= s.points[s.points.length - 1][0] ? s.points : s.points.slice().reverse();
      el('path', { id: id, d: d(pts), fill: 'none' }, defs);
      var t = el('text', { 'font-size': 11, 'letter-spacing': 2, dy: -7, stroke: th.bg, 'stroke-width': 3, 'paint-order': 'stroke' }, lg);
      var tp = el('textPath', { href: '#' + id, startOffset: '50%', 'text-anchor': 'middle' }, t);
      tp.textContent = s.label;
    });
    (config.labels || []).forEach(function (l) {
      var t = el('text', { x: l.x, y: l.y, 'text-anchor': 'middle', 'font-size': l.size || 18, 'letter-spacing': l.spacing || 4,
        transform: l.angle ? 'rotate(' + l.angle + ' ' + l.x + ' ' + l.y + ')' : '', opacity: 0.75,
        'font-style': l.style === 'district' ? 'italic' : 'normal' }, lg);
      t.textContent = l.text;
    });

    // Routes
    var routes = (config.routes || []).map(function (rt) {
      var path = el('path', { d: d(rt.points), fill: 'none', stroke: th.route, 'stroke-width': 4, opacity: 0.95, 'stroke-linecap': 'round',
        'stroke-linejoin': 'round' }, cam);
      var len = path.getTotalLength();
      path.setAttribute('stroke-dasharray', len);
      var head = el('circle', { r: 5, fill: th.route, stroke: th.bg, 'stroke-width': 2 }, cam);
      return { cfg: rt, path: path, len: len, head: head };
    });

    // Markers
    var markers = (config.markers || []).map(function (m) {
      var gm = el('g', { transform: 'translate(' + m.x + ' ' + m.y + ')' }, cam);
      var ring = el('circle', { r: 10, fill: 'none', stroke: th.marker, 'stroke-width': 2 }, gm);
      var dot = el('circle', { r: 6, fill: th.marker, stroke: th.bg, 'stroke-width': 2 }, gm);
      var tg = el('g', {}, gm);
      var tx = el('text', { x: 16, y: 4, 'font-family': FONT, 'font-size': 15, 'font-weight': 'bold', fill: th.ink,
        stroke: th.bg, 'stroke-width': 4, 'paint-order': 'stroke' }, tg);
      tx.textContent = m.label;
      return { cfg: m, g: gm, ring: ring, dot: dot };
    });

    // Fixed overlay: vignette, grain, frame, title (not affected by camera)
    el('rect', { width: W, height: H, filter: 'url(#' + uid + 'grain)', opacity: th.grain, 'pointer-events': 'none',
      fill: '#000' }, svg);
    var vg = el('radialGradient', { id: uid + 'vg', cx: '50%', cy: '50%', r: '70%' }, defs);
    el('stop', { offset: '0.6', 'stop-color': '#000', 'stop-opacity': 0 }, vg);
    el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': th.grain > 0.3 ? 0.45 : 0.6 }, vg);
    el('rect', { width: W, height: H, fill: 'url(#' + uid + 'vg)', 'pointer-events': 'none' }, svg);
    el('rect', { x: 28, y: 28, width: W - 56, height: H - 56, fill: 'none', stroke: th.frame, 'stroke-width': 3 }, svg);
    el('rect', { x: 36, y: 36, width: W - 72, height: H - 72, fill: 'none', stroke: th.frame, 'stroke-width': 1 }, svg);
    if (config.title) {
      el('rect', { x: 50, y: 50, width: 300, height: config.subtitle ? 58 : 38, fill: th.bg, stroke: th.frame, 'stroke-width': 1.5, opacity: 0.92 }, svg);
      var tt = el('text', { x: 64, y: 76, 'font-family': FONT, 'font-size': 20, 'font-weight': 'bold', 'letter-spacing': 3, fill: th.ink }, svg);
      tt.textContent = config.title;
      if (config.subtitle) {
        var st = el('text', { x: 64, y: 96, 'font-family': FONT, 'font-size': 11, 'letter-spacing': 2, fill: th.ink }, svg);
        st.textContent = config.subtitle;
      }
    }
    container.appendChild(svg);

    var raf = null, t0 = null, duration = opts.duration || (config.camera && config.camera.length ? config.camera[config.camera.length - 1].t : 10);

    function render(t) {
      var c = cameraAt(config.camera, t, W, H);
      cam.setAttribute('transform', 'translate(' + W / 2 + ' ' + H / 2 + ') scale(' + c.zoom + ') translate(' + -c.x + ' ' + -c.y + ')');
      var inv = 1 / c.zoom; // keep markers/labels at constant screen size
      routes.forEach(function (r) {
        var u = clamp((t - r.cfg.start) / (r.cfg.duration || 3), 0, 1), e = ease(u);
        r.path.setAttribute('stroke-dashoffset', r.len * (1 - e));
        r.path.setAttribute('stroke-width', 4 * inv);
        r.path.style.opacity = u > 0 ? 1 : 0;
        var p = r.path.getPointAtLength(r.len * e);
        r.head.setAttribute('cx', p.x); r.head.setAttribute('cy', p.y); r.head.setAttribute('r', 5 * inv);
        r.head.style.opacity = u > 0 && u < 1 ? 1 : 0;
      });
      markers.forEach(function (m) {
        var a = clamp((t - m.cfg.start) / 0.5, 0, 1);            // pop-in
        var rad = m.cfg.radius || 10;
        var ph = ((t - m.cfg.start) * 0.8) % 1; if (ph < 0) ph = 0; // pulse period 1.25s
        m.g.setAttribute('transform', 'translate(' + m.cfg.x + ' ' + m.cfg.y + ') scale(' + inv * ease(a) + ')');
        m.g.style.opacity = a > 0 ? 1 : 0;
        m.ring.setAttribute('r', rad * (1 + ph * 2.2));
        m.ring.setAttribute('opacity', a > 0 ? 1 - ph : 0);
        m.dot.setAttribute('r', rad * 0.6 * (1 + 0.12 * Math.sin(ph * Math.PI)));
      });
    }

    function play(loop) {
      stop();
      t0 = null;
      (function tick(now) {
        if (t0 === null) t0 = now;
        var t = (now - t0) / 1000;
        if (loop !== false) t = t % (duration + 1); else t = Math.min(t, duration);
        render(t);
        raf = requestAnimationFrame(tick);
      })(performance.now());
    }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }
    function destroy() { stop(); if (svg.parentNode) svg.parentNode.removeChild(svg); }

    render(0);
    return { render: render, play: play, stop: stop, destroy: destroy, svg: svg, duration: duration };
  }

  return { create: create, cameraAt: cameraAt, themes: THEMES };
});
