# -*- coding: utf-8 -*-
"""
Noyau géométrique et rendu des effets « coin de page » et « papier déchiré ».

Module Python pur (aucune dépendance à GIMP) : il calcule des polygones et des
tampons de pixels RGBA 8 bits que le plug-in GIMP transforme ensuite en calques.
"""
import math
import random

LIGHT = (-0.42, -0.55, 0.72)
_l = math.sqrt(sum(v * v for v in LIGHT))
LIGHT = tuple(v / _l for v in LIGHT)


def clamp(v, a, b):
    return a if v < a else b if v > b else v


# --------------------------------------------------------------------------
# Géométrie de base
# --------------------------------------------------------------------------

def clip_half(poly, nx, ny, c):
    """Sutherland–Hodgman : garde la partie du polygone où nx*x + ny*y <= c."""
    out = []
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        da = nx * ax + ny * ay - c
        db = nx * bx + ny * by - c
        if da <= 0:
            out.append((ax, ay))
        if (da <= 0) != (db <= 0):
            t = da / (da - db)
            out.append((ax + (bx - ax) * t, ay + (by - ay) * t))
    return out


def densify(poly, step):
    out = []
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        m = max(1, int(math.ceil(math.hypot(bx - ax, by - ay) / step)))
        for j in range(m):
            out.append((ax + (bx - ax) * j / m, ay + (by - ay) * j / m))
    return out


def bbox(points, pad=0.0):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0 = int(math.floor(min(xs) - pad))
    y0 = int(math.floor(min(ys) - pad))
    x1 = int(math.ceil(max(xs) + pad))
    y1 = int(math.ceil(max(ys) + pad))
    return x0, y0, x1 - x0, y1 - y0


def shade(rgb, k, spec=0.0):
    out = []
    for v in rgb:
        d = min(255.0, v * k)
        out.append(int(round(d + (255.0 - d) * spec)))
    return tuple(out)


# --------------------------------------------------------------------------
# Bruit « papier déchiré »
# --------------------------------------------------------------------------

def value_noise(rand, cells=0):
    size = cells or 512
    lattice = [rand.random() * 2 - 1 for _ in range(size)]

    def fn(x):
        i0 = math.floor(x)
        f = x - i0
        s = f * f * (3 - 2 * f)
        a = lattice[int(i0) % size]
        b = lattice[int(i0 + 1) % size]
        return a + (b - a) * s
    return fn


def tear_noise(rand, roughness, perimeter=None):
    """Renvoie f(s) ~ [-1, 1] : dentelure fibreuse le long d'un bord (s en px)."""
    octaves = [(110, 0.5), (38, 0.28), (13, 0.14), (4, 0.08 * (0.5 + roughness))]
    fns = []
    for wl, _ in octaves:
        if perimeter:
            cells = max(3, int(round(perimeter / wl)))
            n = value_noise(rand, cells)
            fns.append((lambda n, cells: lambda s: n(s / perimeter * cells))(n, cells))
        else:
            n = value_noise(rand)
            fns.append((lambda n, wl: lambda s: n(s / wl))(n, wl))
    weights = [o[1] for o in octaves]
    total = sum(weights)

    def f(s):
        return sum(fn(s) * wgt for fn, wgt in zip(fns, weights)) / total * 1.6
    return f


# --------------------------------------------------------------------------
# Coin de page
# --------------------------------------------------------------------------
# La feuille est plate jusqu'à la ligne de pli L, s'enroule autour d'un
# cylindre de rayon r puis se rabat à plat. Pour un point à la distance d
# au-delà de L, sa projection devient r·sin(d/r) (d <= πr) ou πr − d.

CORNERS = {'tl': (0, 0), 'tr': (1, 0), 'bl': (0, 1), 'br': (1, 1)}


def corner_depth(dist, r):
    pr = math.pi * r
    if dist >= pr:
        return (dist + pr) / 2.0
    lo, hi = 0.0, pr
    for _ in range(40):
        m = (lo + hi) / 2.0
        if m - r * math.sin(m / r) < dist:
            lo = m
        else:
            hi = m
    return (lo + hi) / 2.0


def curl_geometry(w, h, corner='br', amount=0.3, angle=0.0, radius=0.0):
    """
    amount : déplacement du coin, en fraction de la diagonale (0..1+).
    angle  : écart (degrés) par rapport à la diagonale de la page.
    radius : rayon de la courbure en px (0 = automatique).
    """
    cx, cy = CORNERS[corner]
    C = (cx * w, cy * h)
    # Direction « vers l'intérieur » : le long de la diagonale, tournée de `angle`.
    base = math.atan2((-1 if cy else 1) * h, (-1 if cx else 1) * w)
    a = base + math.radians(angle)
    dist = max(0.5, amount * math.hypot(w, h))
    ux, uy = -math.cos(a), -math.sin(a)          # u pointe de P vers le coin C
    r_max = radius or max(6.0, min(w, h) * 0.12)
    r = min(r_max, 2 + dist * 0.22) if not radius else radius
    k = C[0] * ux + C[1] * uy - corner_depth(dist, r)
    rect = [(0, 0), (w, 0), (w, h), (0, h)]
    front = clip_half(rect, ux, uy, k)
    flap = clip_half(rect, -ux, -uy, -k)
    dmax = max((p[0] * ux + p[1] * uy - k) for p in flap) if flap else 0.0
    return {
        'w': w, 'h': h, 'u': (ux, uy), 'r': r, 'k': k, 'C': C,
        'P': (C[0] - ux * dist, C[1] - uy * dist),
        'front': front, 'flap': flap, 'dmax': dmax,
    }


def _curl_outline(g):
    """Points du rabat projeté (pour la boîte englobante)."""
    ux, uy = g['u']
    k, r = g['k'], g['r']
    pr = math.pi * r
    pts = []
    for (x, y) in densify(g['flap'], 3):
        d = x * ux + y * uy - k
        f = r * math.sin(d / r) if d <= pr else pr - d
        pts.append((x + (f - d) * ux, y + (f - d) * uy))
    return pts


def render_curl(g, back_rgb, progress=None):
    """
    Rend le rabat (verso éclairé) : renvoie (x0, y0, W, H, rgba, silhouette).
    rgba : bytearray RGBA 8 bits ; silhouette : bytearray de couverture (0..255).
    """
    if len(g['flap']) < 3:
        return None
    ux, uy = g['u']
    k, r, w, h = g['k'], g['r'], g['w'], g['h']
    pr = math.pi * r
    dmax = g['dmax']
    x0, y0, W, H = bbox(_curl_outline(g), 2)

    lu = LIGHT[0] * ux + LIGHT[1] * uy
    lz = LIGHT[2]

    # Tables de couleurs : cylindre (θ ∈ [0, π]) et partie rabattue (t ∈ [0, 1])
    N = 512
    cyl = []
    for i in range(N + 1):
        th = math.pi * i / N
        back = th > math.pi / 2
        nu = math.sin(th) if back else -math.sin(th)
        nz = -math.cos(th) if back else math.cos(th)
        diff = max(0.0, nu * lu + nz * lz)
        cyl.append(shade(back_rgb, (0.66 + 0.36 * diff) * (1 if back else 0.8), diff ** 18 * 0.55))
    flat_k = 0.66 + 0.36 * lz
    flat = []
    for i in range(N + 1):
        t = i / N
        if t < 0.35:
            kk = flat_k * (0.9 + 0.1 * t / 0.35)
            sp = 0.0
        else:
            q = (t - 0.35) / 0.65
            kk = flat_k * (1 + 0.02 * q)
            sp = 0.15 * q
        flat.append(shade(back_rgb, kk, sp))
    flat_span = max(1e-6, dmax - pr)

    rgba = bytearray(W * H * 4)
    sil = bytearray(W * H)
    asin = math.asin
    for j in range(H):
        qy = y0 + j + 0.5
        row = j * W
        if progress and j % 32 == 0:
            progress(j / H)
        for i in range(W):
            qx = x0 + i + 0.5
            s = qx * ux + qy * uy - k
            if s > r + 1:
                continue
            acc = 0.0
            cr = cg = cb = 0.0
            cands = []
            if s <= 0.7:
                cands.append((pr - s, -1))
            if -0.5 <= s <= r + 0.5:
                a = asin(clamp(s / r, 0.0, 1.0))
                edge = clamp(r - s + 0.5, 0.0, 1.0)
                cands.append((r * (math.pi - a), edge))
                cands.append((r * a, edge))
            for d, edge in cands:
                shift = d - s
                px = qx + shift * ux
                py = qy + shift * uy
                m = min(px, w - px, py, h - py)
                if m <= -0.5:
                    continue
                cov = min(1.0, m + 0.5)
                if edge >= 0:
                    cov *= edge
                    col = cyl[int(clamp(d / r, 0, math.pi) / math.pi * N)]
                else:
                    col = flat[int(clamp((d - pr) / flat_span, 0, 1) * N)]
                a = cov * (1.0 - acc)
                cr += col[0] * a
                cg += col[1] * a
                cb += col[2] * a
                acc += a
                if acc > 0.998:
                    break
            if acc <= 0.002:
                continue
            idx = (row + i) * 4
            rgba[idx] = int(cr / acc + 0.5)
            rgba[idx + 1] = int(cg / acc + 0.5)
            rgba[idx + 2] = int(cb / acc + 0.5)
            rgba[idx + 3] = int(acc * 255 + 0.5)
            sil[row + i] = int(acc * 255 + 0.5)
    return x0, y0, W, H, rgba, sil


def curl_shadow(g, flap, offset, pad):
    """
    Calque d'ombre (noir + alpha) : silhouette du rabat décalée de `offset`
    + ombre de contact le long du pli. Renvoie (x0, y0, W, H, rgba).
    """
    fx, fy, fw, fh, _, sil = flap
    ox, oy = int(round(offset[0])), int(round(offset[1]))
    x0, y0 = fx - pad, fy - pad
    W, H = fw + 2 * pad, fh + 2 * pad
    ux, uy = g['u']
    k, r, w, h = g['k'], g['r'], g['w'], g['h']
    a0, a1 = -1.4 * r, 1.2 * r
    out = bytearray(W * H * 4)
    for j in range(H):
        qy = y0 + j + 0.5
        sj = j - pad - oy
        for i in range(W):
            qx = x0 + i + 0.5
            a = 0.0
            si = i - pad - ox
            if 0 <= si < fw and 0 <= sj < fh:
                a = sil[sj * fw + si] / 255.0
            if 0 <= qx < w and 0 <= qy < h:
                s = qx * ux + qy * uy - k
                if a0 < s < a1:
                    t = (s - a0) / (a1 - a0)
                    if t < 0.5:
                        c = 0.55 * t / 0.5
                    elif t < 0.62:
                        c = 0.55 - 0.2 * (t - 0.5) / 0.12
                    else:
                        c = 0.35 * (1 - (t - 0.62) / 0.38)
                    a = max(a, c)
            if a > 0:
                out[(j * W + i) * 4 + 3] = int(a * 255 + 0.5)
    return x0, y0, W, H, out


# --------------------------------------------------------------------------
# Papier déchiré
# --------------------------------------------------------------------------

SIDES = ('top', 'right', 'bottom', 'left')


class Tear(object):
    def __init__(self, seed=7, roughness=0.6, depth=9.0, rim=6.0):
        self.seed = seed
        self.roughness = clamp(roughness, 0.0, 1.0)
        self.depth = depth
        self.rim = rim
        rand = random.Random(seed)
        self.n = {}
        for key in SIDES + ('a', 'b'):
            self.n[key] = tear_noise(rand, self.roughness)
            self.n[key + 'Rim'] = tear_noise(rand, 1.0)

    def rim_at(self, fn, s):
        return self.rim * (0.3 + 0.7 * clamp(fn(s) * 0.5 + 0.5, 0.0, 1.0))

    # --- bords ---------------------------------------------------------
    def edges(self, w, h, sides):
        """Polygones (A = bord de l'image, B = bord du papier) pour les côtés déchirés."""
        torn = set(SIDES) if 'all' in sides else set(sides)
        depth, rim = self.depth, self.rim

        def inner(side, s):
            return rim + depth * (1 + self.n[side](s)) if side in torn else 0.0

        def outer(side, s):
            if side not in torn:
                return 0.0
            return max(0.0, inner(side, s) - self.rim_at(self.n[side + 'Rim'], s))

        return self._edge_polygon(w, h, inner, torn), self._edge_polygon(w, h, outer, torn)

    @staticmethod
    def _edge_polygon(w, h, off, torn, step=2.0):
        pts = []

        def run(side, a, b, point):
            if side not in torn:
                pts.append(point(a))
                pts.append(point(b))
                return
            n = max(1, int(math.ceil(abs(b - a) / step)))
            for i in range(n + 1):
                pts.append(point(a + (b - a) * i / n))

        run('top', off('left', 0), w - off('right', 0), lambda x: (x, off('top', x)))
        run('right', off('top', w), h - off('bottom', w), lambda y: (w - off('right', y), y))
        run('bottom', w - off('right', h), off('left', h), lambda x: (x, h - off('bottom', x)))
        run('left', h - off('bottom', 0), off('top', 0), lambda y: (off('left', y), y))
        return pts

    # --- trou ------------------------------------------------------------
    def hole(self, w, h, x=0.5, y=0.5, width=0.6, height=0.22, angle=-25.0):
        cx, cy = x * w, y * h
        a = max(4.0, width * w / 2)
        b = max(4.0, height * h / 2)
        ang = math.radians(angle)
        ca, sa = math.cos(ang), math.sin(ang)
        per = math.pi * (3 * (a + b) - math.sqrt((3 * a + b) * (a + 3 * b)))
        rand = random.Random(self.seed * 31 + 7)
        jag = tear_noise(rand, self.roughness, per)
        rim_n = tear_noise(rand, 1.0, per)
        N = int(clamp(round(per / 2.5), 32, 2400))
        A, B = [], []
        for i in range(N):
            t = i / N * 2 * math.pi
            s = i / N * per
            ex, ey = a * math.cos(t), b * math.sin(t)
            ln = math.hypot(ex, ey)
            rb = max(2.0, ln + self.depth * 1.6 * jag(s))
            ra = rb + self.rim_at(rim_n, s)
            for arr, rr in ((A, ra), (B, rb)):
                px, py = ex / ln * rr, ey / ln * rr
                arr.append((cx + px * ca - py * sa, cy + px * sa + py * ca))
        return A, B

    # --- bande arrachée ------------------------------------------------------
    @staticmethod
    def strip_frame(w, h, direction):
        """(L, T, to_xy, to_st) pour une bande orientée dans `direction`."""
        if direction == 'left':
            return w, h, (lambda s, t: (w - s, t)), (lambda x, y: (w - x, y))
        if direction == 'down':
            return h, w, (lambda s, t: (t, s)), (lambda x, y: (y, x))
        if direction == 'up':
            return h, w, (lambda s, t: (t, h - s)), (lambda x, y: (h - y, x))
        return w, h, (lambda s, t: (s, t)), (lambda x, y: (x, y))

    def strip(self, w, h, position=0.5, width=0.3, direction='right', progress=0.7):
        L, T, to_xy, _ = self.strip_frame(w, h, direction)
        t0 = clamp(position, 0, 1) * T
        hw = clamp(width, 0.02, 1) * T / 2
        X = clamp(progress, 0, 1) * L
        d = self.depth

        def topB(s): return t0 - hw + d * self.n['a'](s)
        def botB(s): return t0 + hw + d * self.n['b'](s)
        def topA(s): return topB(s) - self.rim_at(self.n['aRim'], s)
        def botA(s): return botB(s) + self.rim_at(self.n['bRim'], s)

        def outline(top, bot):
            n = max(2, int(math.ceil(X / 2)))
            pts = [to_xy(X * i / n, top(X * i / n)) for i in range(n + 1)]
            pts += [to_xy(X * i / n, bot(X * i / n)) for i in range(n, -1, -1)]
            return pts

        info = {'L': L, 'X': X, 'hw': hw, 'topA': topA, 'botA': botA, 'direction': direction}
        if X < 0.5:
            return None, None, info
        return outline(topA, botA), outline(topB, botB), info

    def render_roll(self, w, h, info, paper_rgb, radius=0.0):
        """Rouleau de papier au front de la déchirure : (x0, y0, W, H, rgba, silhouette)."""
        L, X, hw = info['L'], info['X'], info['hw']
        if X < 0.5 or X >= L:
            return None
        _, _, to_xy, to_st = self.strip_frame(w, h, info['direction'])
        rr = radius or min(hw * 0.7 + 4, math.sqrt(25 + X * 0.9 / math.pi))
        s0, s1 = X - rr, X + rr * 0.9
        t1 = info['topA'](X) - rr * 0.35
        t2 = info['botA'](X) + rr * 0.35
        na, nb = self.n['aRim'], self.n['bRim']
        corners = [to_xy(s, t) for s in (s0, s1) for t in (t1 - 4, t2 + 4)]
        x0, y0, W, H = bbox(corners, 2)
        stops = [(0, 0.62, 0), (0.18, 0.86, 0), (0.42, 1.0, 0.5), (0.6, 0.97, 0), (0.86, 0.78, 0), (1, 0.66, 0)]

        def color(f):
            for (fa, ka, pa), (fb, kb, pb) in zip(stops, stops[1:]):
                if f <= fb:
                    q = (f - fa) / (fb - fa)
                    return shade(paper_rgb, ka + (kb - ka) * q, pa + (pb - pa) * q)
            return shade(paper_rgb, stops[-1][1])

        lut = [color(i / 255.0) for i in range(256)]
        rgba = bytearray(W * H * 4)
        sil = bytearray(W * H)
        span = s1 - s0
        for j in range(H):
            for i in range(W):
                s, t = to_st(x0 + i + 0.5, y0 + j + 0.5)
                f = (s - s0) / span
                if f < -0.02 or f > 1.02:
                    continue
                # extrémités effilochées et arrondies
                end = rr * 0.25 * (1 - min(1.0, min(f, 1 - f) * 8))
                top = t1 + 2.5 * na(s * 7) + end
                bot = t2 + 2.5 * nb(s * 7) - end
                cov = clamp(min(t - top, bot - t) + 0.5, 0, 1) * clamp(min(s - s0, s1 - s) + 0.5, 0, 1)
                if cov <= 0:
                    continue
                col = lut[int(clamp(f, 0, 1) * 255)]
                idx = (j * W + i) * 4
                rgba[idx:idx + 3] = bytes(col)
                rgba[idx + 3] = int(cov * 255 + 0.5)
                sil[j * W + i] = rgba[idx + 3]
        return x0, y0, W, H, rgba, sil
