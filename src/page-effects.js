/*!
 * page-effects.js — effet de coin de page qui tourne & de papier déchiré
 * Sans dépendance. Fonctionne en <script>, AMD, CommonJS et comme plugin jQuery.
 * Licence MIT.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PageEffects = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Utilitaires
   * ------------------------------------------------------------------ */

  const instances = new WeakMap();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const raf = cb => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16));
  const caf = id => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const pixelRatio = () => Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);

  function resolve(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el || el.nodeType !== 1) throw new Error('page-effects : élément introuvable (' + target + ')');
    return el;
  }

  function readData(el, name) {
    const raw = el.getAttribute('data-' + name);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }

  /** Générateur pseudo-aléatoire déterministe (mulberry32). */
  function prng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Bruit de valeur 1D lissé, dans [-1, 1]. `cells` > 0 => périodique. */
  function valueNoise(rand, cells) {
    const size = cells || 512;
    const lattice = [];
    for (let i = 0; i < size; i++) lattice.push(rand() * 2 - 1);
    return function (x) {
      const i0 = Math.floor(x), f = x - i0, s = f * f * (3 - 2 * f);
      const a = lattice[((i0 % size) + size) % size];
      const b = lattice[(((i0 + 1) % size) + size) % size];
      return a + (b - a) * s;
    };
  }

  /**
   * Fonction de « déchirure » : renvoie un décalage dans [-1, 1] pour une abscisse
   * curviligne s (en px). Plusieurs octaves donnent l'aspect fibreux du papier.
   * Si `perimeter` est fourni, la fonction boucle (contours fermés).
   */
  function tearNoise(rand, roughness, perimeter) {
    const octaves = [[110, 0.5], [38, 0.28], [13, 0.14], [4, 0.08 * (0.5 + roughness)]];
    const fns = octaves.map(([wl]) => {
      const cells = perimeter ? Math.max(3, Math.round(perimeter / wl)) : 0;
      const n = valueNoise(rand, cells);
      return perimeter ? s => n((s / perimeter) * cells) : s => n(s / wl);
    });
    const total = octaves.reduce((acc, o) => acc + o[1], 0);
    return s => fns.reduce((acc, fn, i) => acc + fn(s) * octaves[i][1], 0) / total * 1.6;
  }

  /** Découpe de polygone par demi-plan (Sutherland–Hodgman) : garde n·p <= c. */
  function clipHalf(poly, nx, ny, c) {
    const out = [];
    for (let i = 0, n = poly.length; i < n; i++) {
      const A = poly[i], B = poly[(i + 1) % n];
      const da = nx * A.x + ny * A.y - c, db = nx * B.x + ny * B.y - c;
      if (da <= 0) out.push(A);
      if ((da <= 0) !== (db <= 0)) {
        const t = da / (da - db);
        out.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
      }
    }
    return out;
  }

  /** Subdivise les arêtes d'un polygone (segments de longueur <= step). */
  function densify(poly, step) {
    const out = [];
    for (let i = 0, n = poly.length; i < n; i++) {
      const A = poly[i], B = poly[(i + 1) % n];
      const m = Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) / step));
      for (let j = 0; j < m; j++) out.push({ x: A.x + (B.x - A.x) * j / m, y: A.y + (B.y - A.y) * j / m });
    }
    return out;
  }

  const f2 = v => Math.round(v * 100) / 100;
  const cssPolygon = pts => 'polygon(' + pts.map(p => f2(p.x) + 'px ' + f2(p.y) + 'px').join(',') + ')';
  const svgPath = pts => 'M' + pts.map(p => f2(p.x) + ' ' + f2(p.y)).join('L') + 'Z';

  function tracePath(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function setClip(el, value) {
    el.style.clipPath = value;
    el.style.webkitClipPath = value;
  }

  let colorCtx = null;
  function toRGB(color) {
    colorCtx = colorCtx || document.createElement('canvas').getContext('2d');
    colorCtx.fillStyle = '#ffffff';
    colorCtx.fillStyle = color;
    const v = colorCtx.fillStyle;
    if (v[0] === '#') return [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16));
    const m = v.match(/[\d.]+/g);
    return [+m[0], +m[1], +m[2]];
  }

  /** Couleur `c` assombrie par `k` (0..1+) puis éclaircie vers le blanc par `spec`. */
  function shade(c, k, spec) {
    spec = spec || 0;
    const ch = c.map(v => {
      const d = Math.min(255, v * k);
      return Math.round(d + (255 - d) * spec);
    });
    return 'rgb(' + ch.join(',') + ')';
  }

  /* ------------------------------------------------------------------ *
   * Structure DOM commune : wrapper > [dessous] [élément] [canvas…]
   * ------------------------------------------------------------------ */

  function makeUnder(under) {
    const div = document.createElement('div');
    div.className = 'pe-under';
    div.style.cssText = 'position:absolute;left:0;top:0;z-index:0;overflow:hidden;pointer-events:none;' +
      'background-size:cover;background-position:center;';
    if (under && under.nodeType === 1) {
      div.appendChild(under);
    } else if (typeof under === 'string') {
      const s = under.trim();
      if (s[0] === '<') div.innerHTML = s;
      else if (/^(data:image|https?:|\.{0,2}\/)|\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(s)) div.style.backgroundImage = 'url("' + s + '")';
      else div.style.background = s; // couleur ou dégradé CSS
    }
    return div;
  }

  class Layers {
    constructor(el, cls, under) {
      const cs = getComputedStyle(el);
      this.el = el;
      this.savedStyle = el.getAttribute('style');
      this.parent = el.parentNode;
      this.next = el.nextSibling;

      const wrap = this.wrap = document.createElement('div');
      const inline = /^inline/.test(cs.display);
      wrap.className = 'pe-wrap ' + cls;
      wrap.style.cssText = 'position:relative;isolation:isolate;box-sizing:border-box;' +
        (inline ? 'display:inline-block;vertical-align:top;' : 'display:block;');
      ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].forEach(k => { wrap.style[k] = cs[k]; });
      this.parent.insertBefore(wrap, el);
      wrap.appendChild(el);

      el.style.margin = '0';
      if (cs.display === 'inline') el.style.display = 'block';
      if (cs.position === 'static') el.style.position = 'relative';
      el.style.zIndex = '2';

      this.under = null;
      if (under != null && under !== false && under !== '') {
        this.under = makeUnder(under);
        this.under.style.borderRadius = cs.borderRadius;
        wrap.insertBefore(this.under, el);
      }
    }

    size(w, h) {
      if (this.under) { this.under.style.width = w + 'px'; this.under.style.height = h + 'px'; }
    }

    destroy() {
      if (this.savedStyle == null) this.el.removeAttribute('style');
      else this.el.setAttribute('style', this.savedStyle);
      this.parent.insertBefore(this.el, this.wrap);
      this.wrap.remove();
    }
  }

  /** Canvas superposé dont la taille s'adapte à la zone dessinée (coordonnées locales à l'élément). */
  class Surface {
    constructor(wrap, z) {
      const c = this.canvas = document.createElement('canvas');
      c.className = 'pe-canvas';
      c.style.cssText = 'position:absolute;pointer-events:none;z-index:' + z + ';left:0;top:0;width:0;height:0;';
      wrap.appendChild(c);
      this.ctx = c.getContext('2d');
      this.box = null;
      this.scale = 1;
      this._off = null;
    }

    begin(x0, y0, x1, y1, slack) {
      x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
      const b = this.box, dpr = pixelRatio(), c = this.canvas;
      if (!b || b.dpr !== dpr || x0 < b.x0 || y0 < b.y0 || x1 > b.x1 || y1 > b.y1) {
        const pad = slack == null ? 60 : slack;
        const nb = this.box = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad, dpr };
        const W = nb.x1 - nb.x0, H = nb.y1 - nb.y0;
        this.scale = Math.min(dpr, 4096 / W, 4096 / H);
        c.width = Math.max(1, Math.round(W * this.scale));
        c.height = Math.max(1, Math.round(H * this.scale));
        c.style.left = nb.x0 + 'px'; c.style.top = nb.y0 + 'px';
        c.style.width = W + 'px'; c.style.height = H + 'px';
      }
      const ctx = this.ctx, s = this.scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(s, 0, 0, s, -this.box.x0 * s, -this.box.y0 * s);
      return ctx;
    }

    /** Canvas hors écran de même taille (pour calculer une ombre de silhouette). */
    offscreen() {
      const c = this.canvas;
      const o = this._off || (this._off = document.createElement('canvas'));
      if (o.width !== c.width || o.height !== c.height) { o.width = c.width; o.height = c.height; }
      const ctx = o.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, o.width, o.height);
      ctx.setTransform(this.ctx.getTransform());
      return ctx;
    }

    /** Dessine uniquement l'ombre portée du contenu du canvas hors écran. */
    shadowFrom(off, color, blur, dx, dy) {
      const ctx = this.ctx, s = this.scale, big = this.canvas.width + 200;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.shadowColor = color;
      ctx.shadowBlur = blur * s;
      ctx.shadowOffsetX = big + dx * s;
      ctx.shadowOffsetY = dy * s;
      ctx.drawImage(off.canvas, -big, 0);
      ctx.restore();
    }

    clear() {
      if (!this.box) return;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    reset() {
      this.box = null;
      this.canvas.width = this.canvas.height = 1;
      this.canvas.style.width = this.canvas.style.height = '0px';
    }
  }

  /** Petite classe de base : mesure, ResizeObserver, animation, événements. */
  class Effect {
    _setup(el, cls, under) {
      this.el = el;
      if (instances.has(el)) instances.get(el).destroy();
      instances.set(el, this);
      this.layers = new Layers(el, cls, under);
      this.wrap = this.layers.wrap;
      this._raf = 0;
      this.w = this.h = 0;
      if (typeof ResizeObserver === 'function') {
        this._ro = new ResizeObserver(() => this.refresh());
        this._ro.observe(el);
      }
      if (el.tagName === 'IMG' && !el.complete) el.addEventListener('load', this._onload = () => this.refresh());
    }

    _measure() {
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      const changed = w !== this.w || h !== this.h;
      this.w = w; this.h = h;
      this.layers.size(w, h);
      return changed;
    }

    _tween(duration, step, ease) {
      this._stop();
      return new Promise(done => {
        const t0 = now();
        const frame = () => {
          const t = duration > 0 ? clamp((now() - t0) / duration, 0, 1) : 1;
          step((ease || easeInOut)(t), t);
          if (t < 1) this._raf = raf(frame);
          else { this._raf = 0; done(); }
        };
        frame();
      });
    }

    _stop() { if (this._raf) caf(this._raf); this._raf = 0; }

    _emit(name, detail) {
      this.el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: Object.assign({ instance: this }, detail) }));
    }

    destroy() {
      this._stop();
      if (this._ro) this._ro.disconnect();
      if (this._onload) this.el.removeEventListener('load', this._onload);
      this.layers.destroy();
      instances.delete(this.el);
    }
  }

  /* ------------------------------------------------------------------ *
   * PageCurl — coin de page qui se soulève / tourne
   * ------------------------------------------------------------------ *
   * Modèle : la page est plate jusqu'à une ligne de pli L, puis s'enroule
   * autour d'un cylindre de rayon r et se rabat à plat par-dessus elle-même.
   * Pour un point à la distance d au-delà de L, sa projection devient :
   *   d <= πr : r·sin(d/r)        (sur le cylindre)
   *   d >  πr : πr − d            (partie rabattue, verso visible)
   */

  const CORNERS = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };
  function cornerKey(c) {
    c = String(c || 'br').toLowerCase();
    if (CORNERS[c]) return c;
    return (/bottom|bas/.test(c) ? 'b' : 't') + (/right|droit/.test(c) ? 'r' : 'l');
  }

  /** Trouve la profondeur d du coin sachant que sa projection a reculé de `dist`. */
  function cornerDepth(dist, r) {
    const pr = Math.PI * r;
    if (dist >= pr) return (dist + pr) / 2;
    let lo = 0, hi = pr;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (m - r * Math.sin(m / r) < dist) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  const LIGHT = (() => { const v = [-0.42, -0.55, 0.72], l = Math.hypot(...v); return v.map(x => x / l); })();

  class PageCurl extends Effect {
    constructor(target, options) {
      super();
      const el = resolve(target);
      this.o = Object.assign({}, PageCurl.defaults, readData(el, 'page-curl'), options);
      this._setup(el, 'pe-curl', this.o.under);
      this.surface = new Surface(this.wrap, 3);
      this.state = 'rest';
      this.alpha = 1;
      this.P = null;
      this._buildHotspot();
      this.refresh();
    }

    /* --- géométrie --------------------------------------------------- */

    refresh() {
      this._measure();
      const k = cornerKey(this.o.corner), [cx, cy] = CORNERS[k];
      this.corner = k;
      this.C = { x: cx * this.w, y: cy * this.h };
      this.inward = { x: (cx ? -1 : 1) * Math.SQRT1_2, y: (cy ? -1 : 1) * Math.SQRT1_2 };
      const hs = this.hot, size = Math.min(this.o.hotspot, this.w, this.h);
      hs.style.width = hs.style.height = size + 'px';
      hs.style.left = (cx ? this.w - size : 0) + 'px';
      hs.style.top = (cy ? this.h - size : 0) + 'px';
      hs.style.display = this.o.interactive ? 'block' : 'none';
      if (this.state === 'turned') this._hideFront();
      else if (this.state === 'rest' || !this.P) { this.P = this._pointFor(this.o.peel); this._render(); }
      else this._render();
      return this;
    }

    _pointFor(v) {
      if (v && typeof v === 'object') return { x: +v.x, y: +v.y };
      const a = Math.max(0, +v || 0);
      return { x: this.C.x + this.inward.x * a, y: this.C.y + this.inward.y * a };
    }

    _radius(dist) {
      const rMax = this.o.radius || Math.max(6, Math.min(this.w, this.h) * 0.12);
      return Math.min(rMax, 2 + dist * 0.22);
    }

    /** Avancement 0..1 (distance parcourue par le coin / diagonale). */
    get progress() {
      if (this.state === 'turned') return 1;
      if (!this.P) return 0;
      return clamp(Math.hypot(this.C.x - this.P.x, this.C.y - this.P.y) / Math.hypot(this.w, this.h), 0, 1);
    }

    _hideFront() {
      setClip(this.el, 'polygon(0 0,0 0,0 0)');
      this.surface.reset();
    }

    _render() {
      const { w, h, C, P, o, el } = this;
      const dx = C.x - P.x, dy = C.y - P.y, dist = Math.hypot(dx, dy);
      if (!w || !h || dist < 0.5) { setClip(el, ''); this.surface.clear(); return; }

      const u = { x: dx / dist, y: dy / dist };
      const r = this._radius(dist);
      const k = C.x * u.x + C.y * u.y - cornerDepth(dist, r); // d(p) = p·u − k
      const rect = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

      const front = clipHalf(rect, u.x, u.y, k);
      setClip(el, front.length >= 3 ? cssPolygon(front) : 'polygon(0 0,0 0,0 0)');

      const flap = clipHalf(rect, -u.x, -u.y, -k);
      if (flap.length < 3) { this.surface.clear(); return; }

      const depth = p => p.x * u.x + p.y * u.y - k;
      const pr = Math.PI * r;
      const map = p => {
        const d = depth(p), f = d <= pr ? r * Math.sin(d / r) : pr - d;
        return { x: p.x + (f - d) * u.x, y: p.y + (f - d) * u.y };
      };
      const dMax = Math.max(...flap.map(depth));

      // Trois morceaux : moitié basse du cylindre, moitié haute, partie rabattue à plat.
      // Les contours sont subdivisés pour suivre la courbure, et chaque morceau est
      // rempli d'un seul tenant (pas de liserés entre tranches).
      const mapFlat = p => { const d = depth(p); return { x: p.x + (pr - 2 * d) * u.x, y: p.y + (pr - 2 * d) * u.y }; };
      const slice = (a, b) => clipHalf(clipHalf(flap, -u.x, -u.y, -(k + a)), u.x, u.y, k + b);
      const parts = [];
      const add = (kind, a, b, fn) => {
        if (b <= a) return;
        const poly = slice(a, b);
        if (poly.length >= 3) parts.push({ kind, pts: (kind === 'flat' ? poly : densify(poly, 2)).map(fn) });
      };
      add('low', 0, Math.min(pr / 2, dMax), map);
      add('high', pr / 2 - 0.3, Math.min(pr, dMax), map);
      add('flat', pr - 0.7, dMax, mapFlat);
      const polys = parts;

      // Boîte englobante pour le canvas
      let x0 = 0, y0 = 0, x1 = w, y1 = h;
      polys.forEach(p => p.pts.forEach(q => {
        x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
      }));
      const m = 30 + r;
      const ctx = this.surface.begin(x0 - m, y0 - m, x1 + m, y1 + m);
      ctx.globalAlpha = this.alpha;
      const sh = o.shadow;
      const L0 = { x: C.x - u.x * (C.x * u.x + C.y * u.y - k), y: C.y - u.y * (C.x * u.x + C.y * u.y - k) };

      // 1. Ombre de contact le long du pli
      if (sh > 0) {
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
        const g = ctx.createLinearGradient(L0.x - u.x * r * 1.4, L0.y - u.y * r * 1.4, L0.x + u.x * r * 1.2, L0.y + u.y * r * 1.2);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, 'rgba(0,0,0,' + (0.28 * sh) + ')');
        g.addColorStop(0.62, 'rgba(0,0,0,' + (0.18 * sh) + ')');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      // 2. Ombre portée par le rabat (silhouette complète)
      if (sh > 0) {
        const off = this.surface.offscreen();
        off.fillStyle = '#000';
        polys.forEach(p => { off.beginPath(); tracePath(off, p.pts); off.fill(); });
        ctx.save();
        ctx.globalAlpha = this.alpha;
        this.surface.shadowFrom(off, 'rgba(0,0,0,' + sh + ')', 5 + r * 0.45, 2 + r * 0.18, 3 + r * 0.22);
        ctx.restore();
      }

      // 3. Le rabat, éclairé comme un cylindre (dégradé le long de u)
      const base = toRGB(o.backColor);
      const lu = LIGHT[0] * u.x + LIGHT[1] * u.y, lz = LIGHT[2];
      const colorAt = th => {
        const back = th > Math.PI / 2; // au-delà de π/2 on voit le verso, en deçà l'intérieur de la boucle
        const nu = back ? Math.sin(th) : -Math.sin(th), nz = back ? -Math.cos(th) : Math.cos(th);
        const diff = Math.max(0, nu * lu + nz * lz);
        return shade(base, (0.66 + 0.36 * diff) * (back ? 1 : 0.8), Math.pow(diff, 18) * 0.55);
      };
      const flatK = 0.66 + 0.36 * lz;
      polys.forEach(p => {
        ctx.beginPath(); tracePath(ctx, p.pts);
        if (p.kind === 'flat') {
          const e = { x: L0.x - u.x * (dMax - pr), y: L0.y - u.y * (dMax - pr) };
          const g = ctx.createLinearGradient(L0.x, L0.y, e.x, e.y);
          g.addColorStop(0, shade(base, flatK * 0.9));
          g.addColorStop(0.35, shade(base, flatK));
          g.addColorStop(1, shade(base, flatK * 1.02, 0.15));
          ctx.fillStyle = g;
        } else {
          const g = ctx.createLinearGradient(L0.x, L0.y, L0.x + u.x * r, L0.y + u.y * r);
          const steps = 24;
          for (let i = 0; i <= steps; i++) {
            const th = p.kind === 'low' ? (Math.PI / 2) * i / steps : Math.PI - (Math.PI / 2) * i / steps;
            g.addColorStop(clamp(Math.sin(th), 0, 1), colorAt(th));
          }
          ctx.fillStyle = g;
        }
        ctx.fill();
      });

      // 4. Liseré discret du bord de la feuille rabattue
      const flat = polys.find(p => p.kind === 'flat');
      if (flat) {
        ctx.beginPath(); tracePath(ctx, flat.pts);
        ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 0.8; ctx.stroke();
      }
      if (typeof o.onChange === 'function') o.onChange(this.progress, this);
    }

    /* --- API publique ----------------------------------------------- */

    /** Soulève le coin : nombre (px le long de la diagonale) ou {x, y} (position du coin). */
    peelTo(value, animate) {
      if (this.state === 'turned') this.state = 'anim';
      const target = this._pointFor(value);
      if (animate === false) { this._stop(); this.P = target; this._render(); return Promise.resolve(this); }
      const from = Object.assign({}, this.P);
      return this._tween(this.o.duration, e => {
        this.P = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
        this._render();
      }, easeOut).then(() => this);
    }

    /** Tourne complètement la page (révèle le dessous). */
    turn() {
      if (this.state === 'turned') return Promise.resolve(this);
      const { C, w, h } = this;
      let dx = C.x - this.P.x, dy = C.y - this.P.y, d = Math.hypot(dx, dy);
      const u = d > 2 ? { x: dx / d, y: dy / d } : { x: -this.inward.x, y: -this.inward.y };
      const far = Math.max(...[[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => (C.x - x) * u.x + (C.y - y) * u.y));
      const r = this.o.radius || Math.max(6, Math.min(w, h) * 0.12);
      const dist = 2 * (far + r + 4) - Math.PI * r;
      const from = Object.assign({}, this.P), to = { x: C.x - u.x * dist, y: C.y - u.y * dist };
      this.state = 'anim';
      return this._tween(this.o.duration * 1.6, (e, t) => {
        this.P = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        this.alpha = this.o.fadeOnTurn ? 1 - smoothstep(0.55, 1, t) : 1;
        this._render();
      }).then(() => {
        this.state = 'turned';
        this.alpha = 1;
        this._hideFront();
        this._emit('pagecurl:turn', { corner: this.corner });
        if (typeof this.o.onTurn === 'function') this.o.onTurn(this);
        if (this.o.afterTurn === 'reset') return this.reset();
        return this;
      });
    }

    /** Revient à la position de repos (anime le retour si la page était tournée). */
    reset(animate) {
      const wasTurned = this.state === 'turned';
      this.state = 'anim';
      const rest = this._pointFor(this.o.peel);
      if (animate === false) {
        this._stop(); this.alpha = 1; this.P = rest; this.state = 'rest'; this._render();
        return Promise.resolve(this);
      }
      const from = Object.assign({}, this.P);
      return this._tween(this.o.duration * (wasTurned ? 1.6 : 1), (e, t) => {
        this.P = { x: from.x + (rest.x - from.x) * e, y: from.y + (rest.y - from.y) * e };
        this.alpha = wasTurned && this.o.fadeOnTurn ? smoothstep(0, 0.45, t) : 1;
        this._render();
      }, wasTurned ? easeInOut : easeOut).then(() => {
        this.state = 'rest'; this.alpha = 1;
        this._emit('pagecurl:reset', {});
        return this;
      });
    }

    setOptions(options) {
      Object.assign(this.o, options);
      return this.refresh();
    }

    destroy() {
      this.hot.remove();
      super.destroy();
    }

    /* --- interaction ------------------------------------------------ */

    _buildHotspot() {
      const hs = this.hot = document.createElement('div');
      hs.className = 'pe-hotspot';
      hs.style.cssText = 'position:absolute;z-index:4;touch-action:none;cursor:grab;-webkit-user-select:none;user-select:none;';
      this.wrap.appendChild(hs);

      const local = e => {
        const b = this.wrap.getBoundingClientRect();
        return { x: e.clientX - b.left, y: e.clientY - b.top };
      };
      let grab = null, start = null, moved = 0;

      hs.addEventListener('pointerenter', () => {
        if (this.state === 'rest' && this.o.hoverPeel > this.o.peel) {
          this.state = 'hover';
          this.peelTo(this.o.hoverPeel);
        }
      });
      hs.addEventListener('pointerleave', () => {
        if (this.state === 'hover') { this.state = 'rest'; this.peelTo(this.o.peel); }
      });
      hs.addEventListener('pointerdown', e => {
        if (!this.o.interactive) return;
        if (this.state === 'turned') { if (this.o.clickToTurn) this.reset(); return; }
        e.preventDefault();
        this._stop();
        hs.setPointerCapture(e.pointerId);
        hs.style.cursor = 'grabbing';
        const p = local(e);
        grab = { x: this.P.x - p.x, y: this.P.y - p.y };
        start = p; moved = 0;
        this.state = 'drag';
      });
      hs.addEventListener('pointermove', e => {
        if (this.state !== 'drag' || !grab) return;
        const p = local(e);
        moved = Math.max(moved, Math.hypot(p.x - start.x, p.y - start.y));
        let x = p.x + grab.x, y = p.y + grab.y;
        // Le coin ne peut pas être tiré vers l'extérieur de la page.
        x = this.C.x ? Math.min(x, this.C.x) : Math.max(x, 0);
        y = this.C.y ? Math.min(y, this.C.y) : Math.max(y, 0);
        this.P = { x, y };
        this._render();
      });
      const release = e => {
        if (this.state !== 'drag') return;
        grab = null;
        hs.style.cursor = 'grab';
        try { hs.releasePointerCapture(e.pointerId); } catch (err) { /* déjà relâché */ }
        const click = moved < 4;
        if (this.o.turnable && ((click && this.o.clickToTurn) || (!click && this.progress >= this.o.turnThreshold))) {
          this.turn();
          return;
        }
        const b = hs.getBoundingClientRect();
        const inside = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
        const target = inside && e.pointerType === 'mouse' ? this.o.hoverPeel : this.o.peel;
        this.state = 'anim';
        this.peelTo(target).then(() => {
          if (this.state === 'anim') this.state = target === this.o.peel ? 'rest' : 'hover';
        });
      };
      hs.addEventListener('pointerup', release);
      hs.addEventListener('pointercancel', release);
    }
  }

  PageCurl.defaults = {
    corner: 'br',          // 'tl' | 'tr' | 'bl' | 'br' (ou 'top-left', 'bottom-right'…)
    peel: 0,               // soulèvement au repos, en px (0 = page à plat)
    hoverPeel: 60,         // soulèvement au survol du coin
    interactive: true,     // glisser le coin à la souris / au doigt
    turnable: true,        // relâcher au-delà du seuil tourne la page
    turnThreshold: 0.35,   // seuil (fraction de la diagonale)
    clickToTurn: false,    // un simple clic sur le coin tourne la page
    afterTurn: 'stay',     // 'stay' | 'reset'
    fadeOnTurn: true,      // la feuille s'estompe en fin de rotation
    radius: null,          // rayon max de la courbure (px) — auto par défaut
    backColor: '#f4f4f1',  // couleur du verso du papier
    shadow: 0.45,          // opacité des ombres (0 pour désactiver)
    under: null,           // contenu révélé : Element, HTML, URL d'image, couleur / dégradé CSS
    hotspot: 90,           // taille de la zone sensible dans le coin (px)
    duration: 450,         // durée des animations (ms)
    onTurn: null,
    onChange: null
  };

  /* ------------------------------------------------------------------ *
   * PaperTear — papier déchiré (bords, trou, bande arrachée avec rouleau)
   * ------------------------------------------------------------------ */

  const SIDES = ['top', 'right', 'bottom', 'left'];
  const STRIP_DIRS = {
    right: (w, h) => ({ L: w, T: h, m: [1, 0, 0, 1, 0, 0] }),
    left: (w, h) => ({ L: w, T: h, m: [-1, 0, 0, 1, w, 0] }),
    down: (w, h) => ({ L: h, T: w, m: [0, 1, 1, 0, 0, 0] }),
    up: (w, h) => ({ L: h, T: w, m: [0, -1, 1, 0, 0, h] })
  };

  class PaperTear extends Effect {
    constructor(target, options) {
      super();
      const el = resolve(target);
      const data = readData(el, 'paper-tear');
      this.o = Object.assign({}, PaperTear.defaults, data, options);
      this.o.hole = Object.assign({}, PaperTear.defaults.hole, data.hole, options && options.hole);
      this.o.strip = Object.assign({}, PaperTear.defaults.strip, data.strip, options && options.strip);
      this._setup(el, 'pe-tear pe-tear-' + this.o.mode, this.o.mode === 'edge' ? null : this.o.under);
      this.back = new Surface(this.wrap, 1);
      this.front = new Surface(this.wrap, 3);
      this.progress = clamp(+this.o.strip.progress, 0, 1);
      this._noise();
      if (this.o.mode === 'strip') this._buildHandle();
      this.refresh();
    }

    _noise() {
      const rand = prng(this.o.seed), rough = clamp(this.o.roughness, 0, 1);
      this.n = {};
      SIDES.concat(['a', 'b']).forEach(k => {
        this.n[k] = tearNoise(rand, rough);
        this.n[k + 'Rim'] = tearNoise(rand, 1);
      });
    }

    refresh() {
      this._measure();
      if (!this.w || !this.h) return this;
      const mode = this.o.mode;
      if (mode === 'hole') this._renderHole();
      else if (mode === 'strip') this._renderStrip();
      else this._renderEdges();
      return this;
    }

    setOptions(options) {
      const seed = this.o.seed, rough = this.o.roughness;
      Object.assign(this.o, options, {
        hole: Object.assign(this.o.hole, options && options.hole),
        strip: Object.assign(this.o.strip, options && options.strip)
      });
      if (options && options.strip && options.strip.progress != null) this.progress = clamp(+options.strip.progress, 0, 1);
      if (seed !== this.o.seed || rough !== this.o.roughness) this._noise();
      return this.refresh();
    }

    /** Amplitude de la frange blanche (0..1) pour un bruit donné. */
    _rim(fn, s) { return this.o.rim * (0.3 + 0.7 * clamp(fn(s) * 0.5 + 0.5, 0, 1)); }

    _paperShadow(ctx, blur, dx, dy) {
      const s = this.back.scale;
      ctx.shadowColor = 'rgba(0,0,0,' + this.o.shadow + ')';
      ctx.shadowBlur = blur * s; ctx.shadowOffsetX = dx * s; ctx.shadowOffsetY = dy * s;
    }

    /* --- bords déchirés -------------------------------------------- */

    _renderEdges() {
      const { w, h, o } = this;
      const torn = {};
      (Array.isArray(o.sides) ? o.sides : String(o.sides).split(/[\s,]+/)).forEach(s => {
        if (s === 'all') SIDES.forEach(k => { torn[k] = true; });
        else torn[s] = true;
      });
      const depth = o.depth, rim = o.rim;
      // Décalage vers l'intérieur : `inner` = bord de l'image, `outer` = bord du papier
      const inner = (side, s) => (torn[side] ? rim + depth * (1 + this.n[side](s)) : 0);
      const outer = (side, s) => (torn[side] ? Math.max(0, inner(side, s) - this._rim(this.n[side + 'Rim'], s)) : 0);

      const A = this._edgePolygon(inner, torn), B = this._edgePolygon(outer, torn);
      setClip(this.el, cssPolygon(A));

      const m = 30;
      const ctx = this.back.begin(-m, -m, w + m, h + m, 0);
      ctx.save();
      this._paperShadow(ctx, 7, 0, 2.5);
      ctx.fillStyle = o.paperColor;
      ctx.beginPath(); tracePath(ctx, B); ctx.fill();
      ctx.restore();
      // Fibres : liseré gris très léger sur le bord du papier et ombre douce sur la frange
      ctx.save();
      ctx.beginPath(); tracePath(ctx, B); ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); tracePath(ctx, B); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); tracePath(ctx, A); ctx.stroke();
      ctx.restore();
      this.front.clear();
    }

    _edgePolygon(off, torn) {
      const { w, h } = this, step = 3, pts = [];
      const run = (side, from, to, point) => {
        if (!torn[side]) { pts.push(point(from), point(to)); return; }
        const n = Math.max(1, Math.ceil(Math.abs(to - from) / step));
        for (let i = 0; i <= n; i++) pts.push(point(from + (to - from) * i / n));
      };
      run('top', off('left', 0), w - off('right', 0), x => ({ x, y: off('top', x) }));
      run('right', off('top', w), h - off('bottom', w), y => ({ x: w - off('right', y), y }));
      run('bottom', w - off('right', h), off('left', h), x => ({ x, y: h - off('bottom', x) }));
      run('left', h - off('bottom', 0), off('top', 0), y => ({ x: off('left', y), y }));
      return pts;
    }

    /* --- trou déchiré ---------------------------------------------- */

    _renderHole() {
      const { w, h, o } = this, H = o.hole;
      const cx = H.x * w, cy = H.y * h, a = Math.max(4, H.width * w / 2), b = Math.max(4, H.height * h / 2);
      const ang = (H.angle || 0) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
      const per = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      if (!this._holeNoise || this._holePer !== Math.round(per)) {
        const rand = prng(o.seed * 31 + 7);
        this._holePer = Math.round(per);
        this._holeNoise = [tearNoise(rand, clamp(o.roughness, 0, 1), per), tearNoise(rand, 1, per)];
      }
      const [jag, rimN] = this._holeNoise;
      const N = clamp(Math.round(per / 3), 32, 900);
      const A = [], B = [];
      for (let i = 0; i < N; i++) {
        const t = i / N * Math.PI * 2, s = i / N * per;
        const ex = a * Math.cos(t), ey = b * Math.sin(t), len = Math.hypot(ex, ey);
        const rb = Math.max(2, len + o.depth * 1.6 * jag(s));
        const ra = rb + this._rim(rimN, s);
        const put = (arr, rr) => {
          const x = ex / len * rr, y = ey / len * rr;
          arr.push({ x: cx + x * ca - y * sa, y: cy + x * sa + y * ca });
        };
        put(A, ra); put(B, rb);
      }
      setClip(this.el, 'path(evenodd,"M0 0H' + w + 'V' + h + 'H0Z' + svgPath(A) + '")');
      this._paperWithHole(B);
      this.front.clear();
    }

    /** Papier (blanc) percé du trou B, avec l'ombre portée à l'intérieur du trou. */
    _paperWithHole(B) {
      const { w, h, o } = this;
      const ctx = this.back.begin(0, 0, w, h, 0);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      this._paperShadow(ctx, 9, 2, 3);
      ctx.fillStyle = o.paperColor;
      ctx.beginPath(); ctx.rect(0, 0, w, h); tracePath(ctx, B);
      ctx.fill('evenodd');
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); tracePath(ctx, B); ctx.stroke();
      ctx.restore();
    }

    /* --- bande arrachée avec rouleau --------------------------------- */

    _stripGeometry() {
      const { w, h, o } = this, S = o.strip;
      const dir = (STRIP_DIRS[S.direction] || STRIP_DIRS.right)(w, h);
      const [a, b, c, d, e, f] = dir.m;
      const toXY = (s, t) => ({ x: a * s + c * t + e, y: b * s + d * t + f });
      const t0 = clamp(S.position, 0, 1) * dir.T, hw = clamp(S.width, 0.02, 1) * dir.T / 2;
      const depth = o.depth;
      const topB = s => t0 - hw + depth * this.n.a(s);
      const botB = s => t0 + hw + depth * this.n.b(s);
      const topA = s => topB(s) - this._rim(this.n.aRim, s);
      const botA = s => botB(s) + this._rim(this.n.bRim, s);
      return { dir, toXY, topA, topB, botA, botB, hw };
    }

    _renderStrip() {
      const { w, h, o } = this;
      const g = this._stripGeometry(), L = g.dir.L;
      const X = this.progress * L;
      if (X < 0.5) {
        setClip(this.el, '');
        this.back.clear(); this.front.clear();
        this.handle.style.display = 'none';
        return;
      }
      const edge = (top, bot) => {
        const pts = [], n = Math.max(2, Math.ceil(X / 3));
        for (let i = 0; i <= n; i++) { const s = X * i / n; pts.push(g.toXY(s, top(s))); }
        for (let i = n; i >= 0; i--) { const s = X * i / n; pts.push(g.toXY(s, bot(s))); }
        return pts;
      };
      const A = edge(g.topA, g.botA), B = edge(g.topB, g.botB);
      setClip(this.el, 'path(evenodd,"M0 0H' + w + 'V' + h + 'H0Z' + svgPath(A) + '")');
      this._paperWithHole(B);

      // Rouleau de papier au front de la déchirure
      const rr = o.strip.rollRadius || Math.min(g.hw * 0.7 + 4, Math.sqrt(25 + X * 0.9 / Math.PI) * (o.strip.rollScale || 1));
      const alpha = clamp((L - X) / (rr * 3), 0, 1);
      const ctx = this.front.begin(-rr * 4, -rr * 4, w + rr * 4, h + rr * 4);
      if (!o.strip.roll || alpha <= 0) { this.handle.style.display = 'none'; return; }
      ctx.globalAlpha = alpha;
      ctx.transform(...g.dir.m);
      const t1 = g.topA(X) - rr * 0.35, t2 = g.botA(X) + rr * 0.35, s0 = X - rr, s1 = X + rr * 0.9;
      const body = [], n = 14;
      for (let i = 0; i <= n; i++) { const s = s0 + (s1 - s0) * i / n; body.push({ x: s, y: t1 + 2.5 * this.n.aRim(s * 7) + (i === 0 || i === n ? rr * 0.25 : 0) }); }
      for (let i = n; i >= 0; i--) { const s = s0 + (s1 - s0) * i / n; body.push({ x: s, y: t2 + 2.5 * this.n.bRim(s * 7) - (i === 0 || i === n ? rr * 0.25 : 0) }); }

      const base = toRGB(o.paperColor);
      ctx.save();
      const sc = this.front.scale;
      ctx.shadowColor = 'rgba(0,0,0,' + o.shadow + ')';
      ctx.shadowBlur = (6 + rr * 0.4) * sc; ctx.shadowOffsetX = (2 + rr * 0.15) * sc; ctx.shadowOffsetY = (2 + rr * 0.2) * sc;
      const grad = ctx.createLinearGradient(s0, 0, s1, 0);
      grad.addColorStop(0, shade(base, 0.62));
      grad.addColorStop(0.18, shade(base, 0.86));
      grad.addColorStop(0.42, shade(base, 1, 0.5));
      grad.addColorStop(0.6, shade(base, 0.97));
      grad.addColorStop(0.86, shade(base, 0.78));
      grad.addColorStop(1, shade(base, 0.66));
      ctx.fillStyle = grad;
      ctx.beginPath(); tracePath(ctx, body); ctx.fill();
      ctx.restore();
      // Spirale suggérée aux extrémités + contour doux
      ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); tracePath(ctx, body); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.beginPath(); ctx.moveTo(s0 + rr * 0.5, t1 + rr * 0.6); ctx.lineTo(s0 + rr * 0.5, t2 - rr * 0.6); ctx.stroke();

      // Poignée d'interaction sur le rouleau
      const corners = [[s0, t1], [s1, t1], [s0, t2], [s1, t2]].map(([s, t]) => g.toXY(s, t));
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y), pad = 10;
      const hd = this.handle;
      hd.style.display = this.o.interactive ? 'block' : 'none';
      hd.style.left = (Math.min(...xs) - pad) + 'px';
      hd.style.top = (Math.min(...ys) - pad) + 'px';
      hd.style.width = (Math.max(...xs) - Math.min(...xs) + pad * 2) + 'px';
      hd.style.height = (Math.max(...ys) - Math.min(...ys) + pad * 2) + 'px';
      hd.style.cursor = /right|left/.test(o.strip.direction) ? 'ew-resize' : 'ns-resize';
    }

    _buildHandle() {
      const hd = this.handle = document.createElement('div');
      hd.className = 'pe-handle';
      hd.style.cssText = 'position:absolute;z-index:4;touch-action:none;display:none;';
      this.wrap.appendChild(hd);
      let grab = null;
      const along = e => {
        const r = this.wrap.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        switch (this.o.strip.direction) {
          case 'left': return this.w - x;
          case 'down': return y;
          case 'up': return this.h - y;
          default: return x;
        }
      };
      const L = () => (/up|down/.test(this.o.strip.direction) ? this.h : this.w);
      hd.addEventListener('pointerdown', e => {
        e.preventDefault(); this._stop();
        hd.setPointerCapture(e.pointerId);
        grab = this.progress * L() - along(e);
      });
      hd.addEventListener('pointermove', e => {
        if (grab == null) return;
        this.progress = clamp((along(e) + grab) / L(), 0, 1);
        this._renderStrip();
        this._emit('papertear:progress', { progress: this.progress });
      });
      const up = () => { grab = null; if (this.progress >= 1) this._emit('papertear:complete', {}); };
      hd.addEventListener('pointerup', up);
      hd.addEventListener('pointercancel', up);
    }

    /** Anime l'arrachage de la bande jusqu'à `p` (0..1). */
    tearTo(p, duration) {
      const from = this.progress, to = clamp(+p, 0, 1);
      return this._tween(duration == null ? this.o.duration : duration, e => {
        this.progress = from + (to - from) * e;
        this.refresh();
        this._emit('papertear:progress', { progress: this.progress });
      }, easeInOut).then(() => {
        if (to >= 1) this._emit('papertear:complete', {});
        return this;
      });
    }

    destroy() {
      if (this.handle) this.handle.remove();
      setClip(this.el, '');
      super.destroy();
    }
  }

  PaperTear.defaults = {
    mode: 'edge',            // 'edge' | 'hole' | 'strip'
    sides: 'bottom',         // mode edge : 'top', 'right', 'bottom', 'left', 'all' ou tableau
    depth: 9,                // amplitude des dentelures (px)
    rim: 6,                  // largeur max de la frange blanche (px)
    roughness: 0.6,          // 0..1 : finesse des fibres
    seed: 7,                 // graine : change la forme de la déchirure
    paperColor: '#fbfbf8',   // couleur du papier (âme blanche)
    shadow: 0.35,
    under: null,             // modes hole/strip : contenu révélé (Element, HTML, image, couleur…)
    hole: { x: 0.5, y: 0.5, width: 0.6, height: 0.22, angle: -25 },
    strip: { position: 0.5, width: 0.3, direction: 'right', progress: 1, roll: true, rollRadius: null },
    interactive: true,       // mode strip : le rouleau se tire à la souris / au doigt
    duration: 1400
  };

  /* ------------------------------------------------------------------ *
   * Initialisation automatique & pont jQuery
   * ------------------------------------------------------------------ */

  function init(root) {
    root = root || document;
    const made = [];
    root.querySelectorAll('[data-page-curl]').forEach(el => { if (!instances.has(el)) made.push(new PageCurl(el)); });
    root.querySelectorAll('[data-paper-tear]').forEach(el => { if (!instances.has(el)) made.push(new PaperTear(el)); });
    return made;
  }

  const api = {
    PageCurl,
    PaperTear,
    init,
    get: el => instances.get(resolve(el)),
    pageCurl: (el, opts) => new PageCurl(el, opts),
    paperTear: (el, opts) => new PaperTear(el, opts),
    version: '1.0.0'
  };

  if (typeof window !== 'undefined') {
    const $ = window.jQuery;
    if ($ && $.fn) {
      const bridge = Cls => function (opts) {
        const args = Array.prototype.slice.call(arguments, 1);
        return this.each(function () {
          const inst = instances.get(this);
          if (typeof opts === 'string') { if (inst && typeof inst[opts] === 'function') inst[opts].apply(inst, args); }
          else if (inst instanceof Cls && opts) inst.setOptions(opts);
          else if (!(inst instanceof Cls)) new Cls(this, opts); // eslint-disable-line no-new
        });
      };
      $.fn.pageCurl = bridge(PageCurl);
      $.fn.paperTear = bridge(PaperTear);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
    else init();
  }

  return api;
}));
