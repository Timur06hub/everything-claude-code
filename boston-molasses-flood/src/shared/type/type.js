/* TypeKit: pure functions of time. render(el, params, t) -> sets styles only from t.
   t is in seconds. No timers, no randomness, no network. Same t => same pixels. */
(function (root) {
  'use strict';
  var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  var prog = function (t, s, d) { return clamp((t - s) / d, 0, 1); };
  var easeOut = function (p) { return 1 - Math.pow(1 - p, 3); };
  var easeInOut = function (p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  /* in/out envelope: 0->1 over `fade` at start, 1->0 over `fade` before dur */
  var env = function (t, dur, fade) { return Math.min(prog(t, 0, fade), 1 - prog(t, dur - fade, fade)); };
  var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
  var mount = function (el, cls, html) {
    if (el.__tk !== cls) { el.innerHTML = '<div class="tk-fill ' + cls + '">' + html + '</div>'; el.__tk = cls; }
  };
  var $ = function (el, sel) { return el.querySelector(sel); };

  var C = {};

  /* params: {kicker, title, subtitle, duration} */
  C.titleCard = function (el, p, t) {
    mount(el, 'tk-title', '<div class="kicker"></div><div class="rule"></div><div class="main"></div><div class="sub"></div>');
    var k = $(el, '.kicker'), r = $(el, '.rule'), m = $(el, '.main'), s = $(el, '.sub');
    k.textContent = p.kicker || ''; m.textContent = p.title || ''; s.textContent = p.subtitle || '';
    var d = p.duration || 5, out = 1 - prog(t, d - .5, .5);
    var a = easeOut(prog(t, .1, .6)), b = easeOut(prog(t, .5, .8)), c = easeOut(prog(t, 1.2, .8));
    k.style.opacity = a * out;
    r.style.width = (360 * easeInOut(prog(t, .3, .9))) + 'px';
    m.style.opacity = b * out; m.style.transform = 'translateY(' + (24 * (1 - b)) + 'px)';
    s.style.opacity = c * out;
  };

  /* params: {day, month, year, label, duration}  (strings; shown as given) */
  C.dateStamp = function (el, p, t) {
    mount(el, 'tk-date', '<div class="wrap"><div class="big"></div><div class="label"></div></div>');
    var big = $(el, '.big'), lab = $(el, '.label');
    var parts = [p.month, p.day, p.year].filter(function (x) { return x != null && x !== ''; });
    if (big.children.length !== parts.length) {
      big.innerHTML = parts.map(function (x) { return '<span class="part"><span>' + esc(x) + '</span></span>'; }).join('');
    }
    lab.textContent = p.label || '';
    var d = p.duration || 4, out = 1 - prog(t, d - .4, .4);
    for (var i = 0; i < big.children.length; i++) {
      var e = easeOut(prog(t, .15 + i * .22, .7));
      big.children[i].firstChild.style.transform = 'translateY(' + (105 * (1 - e)) + '%)';
    }
    big.style.opacity = out;
    lab.style.opacity = easeOut(prog(t, .9, .6)) * out;
    lab.style.letterSpacing = (.3 + .12 * (1 - easeOut(prog(t, .9, 1.2)))) + 'em';
  };

  /* params: {name, role, duration}. Transparent overlay: composite over any stage. */
  C.lowerThird = function (el, p, t) {
    mount(el, 'tk-lt-wrap', '<div class="tk-lt"><div class="bar"></div><div class="box"><div class="name"></div><div class="role"></div></div></div>');
    el.style.pointerEvents = 'none';
    $(el, '.name').textContent = p.name || ''; $(el, '.role').textContent = p.role || '';
    var d = p.duration || 4, inn = easeOut(prog(t, 0, .6)), out = easeInOut(prog(t, d - .5, .5));
    var bar = $(el, '.bar'), box = $(el, '.box');
    bar.style.transform = 'scaleY(' + easeOut(prog(t, 0, .35)) + ')';
    var w = inn * (1 - out);
    box.style.clipPath = 'inset(0 ' + (100 * (1 - w)) + '% 0 0)';
    box.style.opacity = w > 0 ? 1 : 0;
    bar.style.opacity = 1 - out;
  };

  /* params: {masthead, edition, price, headline, deck, duration} */
  C.headlineCard = function (el, p, t) {
    mount(el, 'tk-news', '<div class="tk-paper"><div class="mast"></div><div class="meta"><span class="ed"></span><span class="pr"></span></div><div class="hl"></div><div class="deck"></div><div class="cols"><i></i><i></i><i></i></div></div>');
    $(el, '.mast').textContent = p.masthead || 'THE MASTHEAD PLACEHOLDER';
    $(el, '.ed').textContent = p.edition || ''; $(el, '.pr').textContent = p.price || '';
    var hl = $(el, '.hl'), dk = $(el, '.deck'), paper = $(el, '.tk-paper');
    hl.textContent = p.headline || ''; dk.textContent = p.deck || '';
    var d = p.duration || 5, out = 1 - prog(t, d - .5, .5);
    var inn = easeOut(prog(t, 0, .8));
    paper.style.opacity = inn * out;
    paper.style.transform = 'scale(' + (.94 + .06 * inn + .03 * prog(t, 0, d)) + ') rotate(' + (-1.2 * (1 - inn)) + 'deg)';
    hl.style.clipPath = 'inset(0 ' + (100 * (1 - easeInOut(prog(t, .6, 1.0)))) + '% 0 0)';
    dk.style.opacity = easeOut(prog(t, 1.4, .7));
  };

  root.TypeKit = C;
})(typeof window !== 'undefined' ? window : this);
