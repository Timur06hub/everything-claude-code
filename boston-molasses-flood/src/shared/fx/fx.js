/* FX: deterministic archival film look. FX.init(container); FX.update(timeSeconds).
   Pure function of time + seed: same t always yields the same frame. No external requests. */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var FPS = 12; // film "frame" rate for grain/scratch/dust changes
  var st = null;

  // mulberry32 seeded PRNG
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // integer hash -> [0,1)
  function hash(n, salt) { return prng((n * 2654435761 + salt * 97531) >>> 0)(); }
  function smooth(n, salt) { // value noise, smooth in n
    var i = Math.floor(n), f = n - i; f = f * f * (3 - 2 * f);
    return hash(i, salt) * (1 - f) + hash(i + 1, salt) * f;
  }
  function el(tag, cls, parent) {
    var e = document.createElement(tag); e.className = cls; parent.appendChild(e); return e;
  }
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e); return e;
  }
  function makeGrainTiles(count, size, rnd) {
    var urls = [];
    for (var n = 0; n < count; n++) {
      var c = document.createElement('canvas'); c.width = c.height = size;
      var ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = 128 + (rnd() + rnd() + rnd() - 1.5) * 150; // gaussian-ish
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0); urls.push(c.toDataURL('image/png'));
    }
    return urls;
  }

  var FX = {
    init: function (container, opts) {
      opts = opts || {};
      if (typeof container === 'string') container = document.querySelector(container);
      var seed = opts.seed == null ? 1921 : opts.seed;
      var rnd = prng(seed);
      container.classList.add('fx-root');
      var s = st = { c: container, seed: seed, intensity: opts.intensity == null ? 1 : opts.intensity };

      s.leaks = [0, 1, 2].map(function (i) {
        var d = el('div', 'fx-layer fx-leak', container);
        d.style.background = i === 1
          ? 'radial-gradient(ellipse at center, rgba(255,150,60,.55), rgba(255,90,20,0) 70%)'
          : 'radial-gradient(ellipse at center, rgba(255,190,90,.6), rgba(255,120,30,0) 70%)';
        d.style.inset = 'auto'; d.style.width = '60%'; d.style.height = '70%';
        return d;
      });
      s.grade = el('div', 'fx-layer fx-grade', container);

      s.tiles = makeGrainTiles(6, 256, rnd);
      s.grain = el('div', 'fx-layer fx-grain', container);

      var svg = svgEl('svg', { 'class': 'fx-layer fx-svg', viewBox: '0 0 1000 1000', preserveAspectRatio: 'none' }, container);
      s.scratchG = svgEl('g', {}, svg);
      s.dustG = svgEl('g', {}, svg);
      s.scratches = []; s.dust = [];
      for (var i = 0; i < 5; i++) s.scratches.push(svgEl('line', { stroke: '#f2e2c4', 'stroke-linecap': 'round' }, s.scratchG));
      for (i = 0; i < 24; i++) s.dust.push(svgEl('ellipse', { fill: i % 3 ? '#e8d8b8' : '#0a0604' }, s.dustG));

      s.vig = el('div', 'fx-layer fx-vignette', container);
      s.flick = el('div', 'fx-layer fx-flicker', container);
      FX.update(0);
    },

    update: function (t) {
      var s = st; if (!s) return;
      var k = s.intensity, seed = s.seed;
      var f = Math.floor(t * FPS); // film frame index

      // grain: choose tile + offset per frame
      s.grain.style.backgroundImage = 'url(' + s.tiles[Math.floor(hash(f, seed + 1) * s.tiles.length)] + ')';
      s.grain.style.backgroundPosition = Math.floor(hash(f, seed + 2) * 256) + 'px ' + Math.floor(hash(f, seed + 3) * 256) + 'px';
      s.grain.style.opacity = (0.2 * k).toFixed(3);

      // flicker: smooth low-freq plus per-frame jitter, subtle
      var fl = smooth(t * 7, seed + 4) * 0.6 + hash(f, seed + 5) * 0.4;
      s.flick.style.opacity = (Math.max(0, fl - 0.35) * 0.22 * k).toFixed(3);

      // light leaks: slow drifting warm blobs, pulse in and out
      s.leaks.forEach(function (d, i) {
        var ph = t * (0.05 + i * 0.023) + i * 2.1;
        var x = 50 + 55 * Math.sin(ph * 2 * Math.PI * 0.5 + i) - 30;
        var y = i === 2 ? 85 : (i === 1 ? -35 : 20 + 25 * Math.cos(ph + i));
        var a = Math.pow(Math.max(0, Math.sin(t * (0.11 + 0.04 * i) + i * 1.7 + seed)), 3);
        d.style.left = x + '%'; d.style.top = y + '%';
        d.style.opacity = (a * 0.8 * k).toFixed(3);
      });

      // scratches: vertical, persist a few frames (hold = frame block)
      var blk = Math.floor(f / 3);
      s.scratches.forEach(function (ln, i) {
        var on = hash(blk, seed + 10 + i) < 0.28;
        if (!on) { ln.setAttribute('opacity', 0); return; }
        var x = hash(blk, seed + 20 + i) * 1000, x2 = x + (hash(blk, seed + 30 + i) - 0.5) * 14;
        var y1 = hash(blk, seed + 40 + i) * 300, y2 = 500 + hash(blk, seed + 50 + i) * 500;
        ln.setAttribute('x1', x.toFixed(1)); ln.setAttribute('x2', x2.toFixed(1));
        ln.setAttribute('y1', y1.toFixed(1)); ln.setAttribute('y2', y2.toFixed(1));
        ln.setAttribute('stroke-width', (0.6 + hash(blk, seed + 60 + i) * 1.4).toFixed(2));
        ln.setAttribute('opacity', ((0.12 + hash(blk, seed + 70 + i) * 0.3) * k).toFixed(3));
      });

      // dust specks: new random set every frame, mostly absent
      s.dust.forEach(function (d, i) {
        if (hash(f, seed + 100 + i) > 0.35) { d.setAttribute('opacity', 0); return; }
        var r = 1 + Math.pow(hash(f, seed + 200 + i), 3) * 5;
        d.setAttribute('cx', (hash(f, seed + 300 + i) * 1000).toFixed(1));
        d.setAttribute('cy', (hash(f, seed + 400 + i) * 1000).toFixed(1));
        d.setAttribute('rx', r.toFixed(2)); d.setAttribute('ry', (r * (0.5 + hash(f, seed + 500 + i))).toFixed(2));
        d.setAttribute('opacity', ((0.25 + hash(f, seed + 600 + i) * 0.5) * k).toFixed(3));
      });
    }
  };
  root.FX = FX;
  if (typeof module !== 'undefined') module.exports = FX;
})(typeof window !== 'undefined' ? window : this);
