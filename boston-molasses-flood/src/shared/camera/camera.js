/* Deterministic camera-move library (vanilla JS, UMD). Pure function of time + spec.
 * Camera.apply(layers, timeSeconds, moveSpec) -> array of {x,y,scale,rotate} per layer;
 * also writes style.transform on each layer.el when present.
 * layer: { el?, depth }  depth 0 = farthest (moves least), 1 = nearest (moves most).
 * moveSpec: { type: 'push-in'|'pull-out'|'pan'|'parallax'|'drift'|'static',
 *   duration (s), ease (name), zoomFrom, zoomTo, panFrom:{x,y}, panTo:{x,y} (px),
 *   parallax (0..1+ depth separation), drift:{seed, amp (px), rot (deg), freq (Hz)} } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Camera = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var easings = {
    linear: function (t) { return t; },
    easeInQuad: function (t) { return t * t; },
    easeOutQuad: function (t) { return t * (2 - t); },
    easeInOutQuad: function (t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; },
    easeInCubic: function (t) { return t * t * t; },
    easeOutCubic: function (t) { var u = 1 - t; return 1 - u * u * u; },
    easeInOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    easeInOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
    smoothstep: function (t) { return t * t * (3 - 2 * t); },
    smootherstep: function (t) { return t * t * t * (t * (6 * t - 15) + 10); }
  };

  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Seeded PRNG (mulberry32) + hashed lattice value noise: stateless, so any t is reproducible.
  function hash(seed, i) {
    var a = (seed + Math.imul(i | 0, 0x9E3779B1)) | 0;
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  }
  function noise1(seed, x) {
    var i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
    return lerp(hash(seed, i), hash(seed, i + 1), s) * 2 - 1;
  }
  function seededRandom(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var presets = {
    'push-in': { zoomFrom: 1, zoomTo: 1.12 },
    'pull-out': { zoomFrom: 1.12, zoomTo: 1 },
    'pan': { panFrom: { x: -60, y: 0 }, panTo: { x: 60, y: 0 } },
    'parallax': { panFrom: { x: -80, y: 0 }, panTo: { x: 80, y: 0 }, parallax: 1 },
    'drift': { drift: { seed: 1, amp: 6, rot: 0.15, freq: 0.35 } },
    'static': {}
  };

  function resolve(spec) {
    var p = presets[spec && spec.type] || {};
    var s = {}, k;
    for (k in p) s[k] = p[k];
    for (k in (spec || {})) s[k] = spec[k];
    return s;
  }

  function sample(t, spec) {
    var s = resolve(spec);
    var dur = s.duration > 0 ? s.duration : 10;
    var ease = typeof s.ease === 'function' ? s.ease : (easings[s.ease] || easings.easeInOutSine);
    var p = ease(clamp01(t / dur));
    var zf = s.zoomFrom == null ? 1 : s.zoomFrom, zt = s.zoomTo == null ? zf : s.zoomTo;
    var pf = s.panFrom || { x: 0, y: 0 }, pt = s.panTo || pf;
    var out = {
      zoom: lerp(zf, zt, p),
      x: lerp(pf.x || 0, pt.x || 0, p),
      y: lerp(pf.y || 0, pt.y || 0, p),
      rot: 0, parallax: s.parallax == null ? 0.6 : s.parallax
    };
    if (s.drift) {
      var d = s.drift, seed = d.seed | 0, f = d.freq || 0.35, a = d.amp == null ? 6 : d.amp;
      out.x += noise1(seed, t * f) * a;
      out.y += noise1(seed + 101, t * f * 1.13) * a;
      out.rot = noise1(seed + 202, t * f * 0.8) * (d.rot == null ? 0.15 : d.rot);
    }
    return out;
  }

  function apply(layers, t, spec) {
    var c = sample(t, spec), res = [];
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i], depth = L.depth == null ? 0.5 : L.depth;
      // Depth factor: far layers move/scale less, near layers more.
      var k = 1 - c.parallax + c.parallax * (0.25 + 1.5 * depth);
      var tr = {
        x: c.x * k,
        y: c.y * k,
        scale: 1 + (c.zoom - 1) * (1 - c.parallax + c.parallax * (0.5 + depth)),
        rotate: c.rot
      };
      if (L.el && L.el.style) {
        L.el.style.transformOrigin = '50% 50%';
        L.el.style.transform = 'translate3d(' + tr.x.toFixed(3) + 'px,' + tr.y.toFixed(3) + 'px,0) rotate(' +
          tr.rotate.toFixed(4) + 'deg) scale(' + tr.scale.toFixed(5) + ')';
      }
      res.push(tr);
    }
    return res;
  }

  return { apply: apply, sample: sample, easings: easings, seededRandom: seededRandom, noise1: noise1, presets: presets };
});
