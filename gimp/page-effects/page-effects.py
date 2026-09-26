#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Effets de page pour GIMP 3 : coin de page qui tourne & papier déchiré.

Menu : Filtres > Effets de page
  - Coin de page…      (plug-in-pe-page-curl)
  - Papier déchiré…    (plug-in-pe-paper-tear)

Les effets sont non destructifs : le calque d'origine reçoit un masque de
calque, et le verso de la page, le papier et les ombres sont créés dans des
calques séparés, modifiables ensuite. Ce qui est « révélé » sous la page est
simplement le contenu des calques situés en dessous.
"""
import os
import sys

import gi
gi.require_version('Gimp', '3.0')
gi.require_version('GimpUi', '3.0')
gi.require_version('Gegl', '0.4')
gi.require_version('Babl', '0.1')
from gi.repository import Babl, Gimp, GimpUi, Gegl, GObject, GLib  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pe_core  # noqa: E402

PROC_CURL = 'plug-in-pe-page-curl'
PROC_TEAR = 'plug-in-pe-paper-tear'
MENU = '<Image>/Filters/Effets de page'
RW = GObject.ParamFlags.READWRITE
FMT = "R'G'B'A u8"


# --------------------------------------------------------------------------
# Aides GIMP
# --------------------------------------------------------------------------

def color_rgb(color, default):
    """Gegl.Color -> (r, g, b) 0..255 dans l'espace sRGB.

    Une couleur non initialisée (alpha nul, cas d'un appel par script sans
    valeur explicite) est remplacée par `default`.
    """
    if color is None or color.get_rgba()[3] <= 0:
        return default
    try:
        data = color.get_bytes(Babl.format("R'G'B' u8")).get_data()
        return tuple(data[:3])
    except Exception:  # noqa: BLE001 — repli : RGBA linéaire -> sRGB
        r, g, b, _ = color.get_rgba()

        def enc(v):
            v = pe_core.clamp(v, 0.0, 1.0)
            return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        return tuple(int(round(enc(c) * 255)) for c in (r, g, b))


def gegl_color(rgb):
    return Gegl.Color.new('#%02x%02x%02x' % tuple(rgb))


def new_layer(image, name, x, y, w, h, ref, above=True, opacity=100.0):
    """Crée un calque RGBA à côté de `ref` (au-dessus ou en dessous)."""
    layer = Gimp.Layer.new(image, name, max(1, w), max(1, h), Gimp.ImageType.RGBA_IMAGE,
                           opacity, Gimp.LayerMode.NORMAL)
    parent = ref.get_parent()
    pos = image.get_item_position(ref) + (0 if above else 1)
    image.insert_layer(layer, parent, pos)
    layer.set_offsets(int(x), int(y))
    return layer


def put_pixels(layer, w, h, data):
    buf = layer.get_buffer()
    buf.set(Gegl.Rectangle.new(0, 0, w, h), FMT, bytes(data))
    buf.flush()
    layer.update(0, 0, w, h)


def gaussian_blur(drawable, radius):
    if radius <= 0:
        return
    std = radius / 2.0
    try:
        f = Gimp.DrawableFilter.new(drawable, 'gegl:gaussian-blur', 'Flou')
        cfg = f.get_config()
        cfg.set_property('std-dev-x', std)
        cfg.set_property('std-dev-y', std)
        f.update()
        drawable.merge_filter(f)
    except Exception:  # noqa: BLE001 — repli pour les versions sans DrawableFilter
        proc = Gimp.get_pdb().lookup_procedure('plug-in-gauss')
        cfg = proc.create_config()
        cfg.set_property('run-mode', Gimp.RunMode.NONINTERACTIVE)
        cfg.set_property('image', drawable.get_image())
        cfg.set_property('drawable', drawable)
        cfg.set_property('horizontal', radius)
        cfg.set_property('vertical', radius)
        proc.run(cfg)


def select_polygon(image, pts, dx, dy, op=Gimp.ChannelOps.REPLACE):
    segs = []
    for x, y in pts:
        segs += [x + dx, y + dy]
    image.select_polygon(op, segs)


def fill_selection(drawable, rgb):
    Gimp.context_push()
    Gimp.context_set_foreground(gegl_color(rgb))
    drawable.edit_fill(Gimp.FillType.FOREGROUND)
    Gimp.context_pop()


def ensure_mask(layer):
    if not layer.has_alpha():
        layer.add_alpha()
    mask = layer.get_mask()
    if mask is None:
        mask = layer.create_mask(Gimp.AddMaskType.WHITE)
        layer.add_mask(mask)
    return mask


def hide_outside(image, layer, keep, holes=()):
    """Masque tout le calque sauf le polygone `keep` (moins les trous `holes`)."""
    mask = ensure_mask(layer)
    ox, oy = layer.get_offsets()[1:]
    w, h = layer.get_width(), layer.get_height()
    select_polygon(image, [(0, 0), (w, 0), (w, h), (0, h)], ox, oy)
    if keep:
        select_polygon(image, keep, ox, oy, Gimp.ChannelOps.SUBTRACT)
    for hole in holes:
        select_polygon(image, hole, ox, oy, Gimp.ChannelOps.ADD)
    fill_selection(mask, (0, 0, 0))
    Gimp.Selection.none(image)


def shadow_from_selection(image, ref, name, pad, blur, offset, opacity, clip_rect=None):
    """Calque d'ombre (noir) à partir de la sélection courante, flouté et décalé."""
    ox, oy = ref.get_offsets()[1:]
    w, h = ref.get_width(), ref.get_height()
    layer = new_layer(image, name, ox - pad, oy - pad, w + 2 * pad, h + 2 * pad, ref, above=False, opacity=opacity)
    fill_selection(layer, (0, 0, 0))
    Gimp.Selection.none(image)
    gaussian_blur(layer, blur)
    layer.set_offsets(ox - pad + int(round(offset[0])), oy - pad + int(round(offset[1])))
    if clip_rect:
        # l'ombre ne doit pas déborder du papier (trou, bande)
        cx, cy, cw, ch = clip_rect
        image.select_rectangle(Gimp.ChannelOps.REPLACE, cx, cy, cw, ch)
        Gimp.Selection.invert(image)
        layer.edit_clear()
        Gimp.Selection.none(image)
    return layer


def target_layer(drawables):
    if len(drawables) != 1:
        raise ValueError('Sélectionnez un seul calque.')
    layer = drawables[0]
    if not isinstance(layer, Gimp.Layer) or layer.is_group():
        raise ValueError('Le calque actif doit être un calque de pixels (pas un groupe ni un masque).')
    return layer


# --------------------------------------------------------------------------
# Effets
# --------------------------------------------------------------------------

def apply_page_curl(image, layer, corner, amount, angle, radius, back_rgb, shadow, fill_under, under_rgb):
    w, h = layer.get_width(), layer.get_height()
    ox, oy = layer.get_offsets()[1:]
    g = pe_core.curl_geometry(w, h, corner, amount / 100.0, angle, radius)

    Gimp.progress_init('Coin de page…')
    flap = pe_core.render_curl(g, back_rgb, progress=lambda f: Gimp.progress_update(f * 0.8))
    if flap is None:
        return

    if fill_under:
        under = new_layer(image, 'Dessous', ox, oy, w, h, layer, above=False)
        image.select_rectangle(Gimp.ChannelOps.REPLACE, ox, oy, w, h)
        fill_selection(under, under_rgb)
        Gimp.Selection.none(image)

    # 1. La page : masque = partie restée à plat
    hide_outside(image, layer, g['front'])

    # 2. Ombre (portée par le rabat + contact le long du pli)
    r = g['r']
    top = layer  # le verso doit être au-dessus de l'ombre
    if shadow > 0:
        blur = 4 + r * 0.4
        pad = int(1.6 * r + 3 * blur + 12)
        sx, sy, sw, sh, sbuf = pe_core.curl_shadow(g, flap, (2 + r * 0.18, 3 + r * 0.22), pad)
        sl = new_layer(image, 'Coin de page — ombre', ox + sx, oy + sy, sw, sh, layer, above=True, opacity=shadow)
        put_pixels(sl, sw, sh, sbuf)
        gaussian_blur(sl, blur)
        top = sl

    # 3. Le verso de la page
    fx, fy, fw, fh, fbuf, _ = flap
    fl = new_layer(image, 'Coin de page — verso', ox + fx, oy + fy, fw, fh, top, above=True)
    put_pixels(fl, fw, fh, fbuf)
    Gimp.progress_update(1.0)


def apply_paper_tear(image, layer, cfg):
    w, h = layer.get_width(), layer.get_height()
    ox, oy = layer.get_offsets()[1:]
    mode = cfg['mode']
    paper = cfg['paper']
    tear = pe_core.Tear(seed=cfg['seed'], roughness=cfg['roughness'] / 100.0, depth=cfg['depth'], rim=cfg['rim'])
    shadow = cfg['shadow']
    Gimp.progress_init('Papier déchiré…')

    if mode == 'edge':
        sides = [s for s in pe_core.SIDES if cfg['side_' + s]]
        if not sides:
            raise ValueError('Choisissez au moins un côté à déchirer.')
        A, B = tear.edges(w, h, sides)
        hide_outside(image, layer, A)
        # papier (frange blanche) sous l'image, puis ombre sous le papier
        pl = new_layer(image, 'Papier déchiré — papier', ox, oy, w, h, layer, above=False)
        select_polygon(image, B, ox, oy)
        fill_selection(pl, paper)
        if shadow > 0:
            select_polygon(image, B, ox, oy)
            shadow_from_selection(image, pl, 'Papier déchiré — ombre', 30, 7, (0, 2.5), shadow)
        Gimp.Selection.none(image)
        return

    if mode == 'hole':
        A, B = tear.hole(w, h, cfg['hole_x'] / 100.0, cfg['hole_y'] / 100.0,
                         cfg['hole_w'] / 100.0, cfg['hole_h'] / 100.0, cfg['hole_angle'])
        info = None
    else:
        A, B, info = tear.strip(w, h, cfg['strip_pos'] / 100.0, cfg['strip_width'] / 100.0,
                                cfg['strip_dir'], cfg['strip_progress'] / 100.0)
        if A is None:
            return

    rect = [(0, 0), (w, 0), (w, h), (0, h)]
    hide_outside(image, layer, rect, holes=[A])

    # Papier percé d'un trou un peu plus petit : la frange blanche apparaît entre les deux.
    pl = new_layer(image, 'Papier déchiré — papier', ox, oy, w, h, layer, above=False)
    select_polygon(image, rect, ox, oy)
    select_polygon(image, B, ox, oy, Gimp.ChannelOps.SUBTRACT)
    fill_selection(pl, paper)
    if shadow > 0:
        select_polygon(image, rect, ox, oy)
        select_polygon(image, B, ox, oy, Gimp.ChannelOps.SUBTRACT)
        shadow_from_selection(image, pl, 'Papier déchiré — ombre', 30, 9, (2, 3), shadow, clip_rect=(ox, oy, w, h))
    Gimp.Selection.none(image)

    if info is not None and cfg['strip_roll']:
        roll = tear.render_roll(w, h, info, paper, cfg['roll_radius'])
        if roll:
            rx, ry, rw, rh, rbuf, rsil = roll
            top = layer
            if shadow > 0:
                pad = 24
                sbuf = bytearray((rw + 2 * pad) * (rh + 2 * pad) * 4)
                for j in range(rh):
                    for i in range(rw):
                        sbuf[((j + pad) * (rw + 2 * pad) + i + pad) * 4 + 3] = rsil[j * rw + i]
                sl = new_layer(image, 'Rouleau — ombre', ox + rx - pad + 3, oy + ry - pad + 3,
                               rw + 2 * pad, rh + 2 * pad, layer, above=True, opacity=shadow)
                put_pixels(sl, rw + 2 * pad, rh + 2 * pad, sbuf)
                gaussian_blur(sl, 8)
                top = sl
            rl = new_layer(image, 'Rouleau', ox + rx, oy + ry, rw, rh, top, above=True)
            put_pixels(rl, rw, rh, rbuf)
    Gimp.progress_update(1.0)


# --------------------------------------------------------------------------
# Déclaration des procédures
# --------------------------------------------------------------------------

def _choice(items):
    ch = Gimp.Choice.new()
    for i, (nick, label) in enumerate(items):
        ch.add(nick, i, label, '')
    return ch


def run_with_dialog(procedure, run_mode, image, config, title):
    if run_mode == Gimp.RunMode.INTERACTIVE:
        GimpUi.init(procedure.get_name())
        dialog = GimpUi.ProcedureDialog.new(procedure, config, title)
        dialog.fill(None)
        ok = dialog.run()
        dialog.destroy()
        return ok
    return True


def _fail(procedure, message):
    return procedure.new_return_values(Gimp.PDBStatusType.EXECUTION_ERROR,
                                       GLib.Error.new_literal(Gimp.PlugIn.error_quark(), message, 0))


def curl_run(procedure, run_mode, image, drawables, config, data):
    if not run_with_dialog(procedure, run_mode, image, config, 'Coin de page'):
        return procedure.new_return_values(Gimp.PDBStatusType.CANCEL, GLib.Error())
    try:
        layer = target_layer(drawables)
        image.undo_group_start()
        try:
            apply_page_curl(
                image, layer,
                corner=config.get_property('corner'),
                amount=config.get_property('amount'),
                angle=config.get_property('angle'),
                radius=config.get_property('radius'),
                back_rgb=color_rgb(config.get_property('back-color'), (244, 244, 241)),
                shadow=config.get_property('shadow'),
                fill_under=config.get_property('fill-under'),
                under_rgb=color_rgb(config.get_property('under-color'), (255, 255, 255)),
            )
        finally:
            image.undo_group_end()
    except ValueError as e:
        return _fail(procedure, str(e))
    Gimp.displays_flush()
    return procedure.new_return_values(Gimp.PDBStatusType.SUCCESS, GLib.Error())


def tear_run(procedure, run_mode, image, drawables, config, data):
    if not run_with_dialog(procedure, run_mode, image, config, 'Papier déchiré'):
        return procedure.new_return_values(Gimp.PDBStatusType.CANCEL, GLib.Error())
    p = config.get_property
    cfg = {
        'mode': p('mode'), 'depth': p('depth'), 'rim': p('rim'), 'roughness': p('roughness'),
        'seed': p('seed'), 'paper': color_rgb(p('paper-color'), (251, 251, 248)), 'shadow': p('shadow'),
        'side_top': p('side-top'), 'side_right': p('side-right'),
        'side_bottom': p('side-bottom'), 'side_left': p('side-left'),
        'hole_x': p('hole-x'), 'hole_y': p('hole-y'), 'hole_w': p('hole-width'),
        'hole_h': p('hole-height'), 'hole_angle': p('hole-angle'),
        'strip_pos': p('strip-position'), 'strip_width': p('strip-width'),
        'strip_dir': p('strip-direction'), 'strip_progress': p('strip-progress'),
        'strip_roll': p('strip-roll'), 'roll_radius': p('roll-radius'),
    }
    try:
        layer = target_layer(drawables)
        image.undo_group_start()
        try:
            apply_paper_tear(image, layer, cfg)
        finally:
            image.undo_group_end()
    except ValueError as e:
        return _fail(procedure, str(e))
    Gimp.displays_flush()
    return procedure.new_return_values(Gimp.PDBStatusType.SUCCESS, GLib.Error())


class PageEffects(Gimp.PlugIn):
    def do_query_procedures(self):
        return [PROC_CURL, PROC_TEAR]

    def do_set_i18n(self, name):
        return False

    def do_create_procedure(self, name):
        if name == PROC_CURL:
            proc = Gimp.ImageProcedure.new(self, name, Gimp.PDBProcType.PLUGIN, curl_run, None)
            proc.set_menu_label('_Coin de page…')
            proc.set_documentation(
                'Coin de page qui se soulève / tourne',
                'Enroule un coin du calque comme une feuille de papier. La page reçoit un masque, '
                'le verso et l\'ombre sont créés dans des calques séparés ; les calques du dessous '
                'apparaissent sous la page.', name)
            proc.add_choice_argument('corner', '_Coin', 'Coin à soulever', _choice([
                ('br', 'Bas droit'), ('bl', 'Bas gauche'), ('tr', 'Haut droit'), ('tl', 'Haut gauche')]), 'br', RW)
            proc.add_double_argument('amount', '_Soulèvement (%)', 'Déplacement du coin, en % de la diagonale',
                                     1.0, 120.0, 30.0, RW)
            proc.add_double_argument('angle', '_Angle (°)', 'Écart par rapport à la diagonale', -60.0, 60.0, 0.0, RW)
            proc.add_double_argument('radius', '_Rayon de courbure (px, 0 = auto)', 'Rayon du rouleau',
                                     0.0, 2000.0, 0.0, RW)
            proc.add_color_argument('back-color', 'Couleur du _verso', 'Couleur du dos du papier',
                                    False, Gegl.Color.new('#f4f4f1'), RW)
            proc.add_double_argument('shadow', '_Ombre (%)', 'Opacité de l\'ombre', 0.0, 100.0, 50.0, RW)
            proc.add_boolean_argument('fill-under', 'Remplir le _dessous', 'Ajoute un calque de couleur sous la page',
                                      False, RW)
            proc.add_color_argument('under-color', 'Couleur du dessous', 'Couleur révélée sous la page',
                                    False, Gegl.Color.new('#ffffff'), RW)
        else:
            proc = Gimp.ImageProcedure.new(self, name, Gimp.PDBProcType.PLUGIN, tear_run, None)
            proc.set_menu_label('_Papier déchiré…')
            proc.set_documentation(
                'Effet de papier déchiré',
                'Bords déchirés, trou arraché ou bande arrachée avec rouleau. Le calque reçoit un masque ; '
                'la frange blanche du papier et les ombres sont créées dans des calques séparés.', name)
            proc.add_choice_argument('mode', '_Type', 'Type de déchirure', _choice([
                ('edge', 'Bords déchirés'), ('hole', 'Trou arraché'), ('strip', 'Bande arrachée (rouleau)')]),
                'edge', RW)
            proc.add_double_argument('depth', '_Profondeur des dents (px)', 'Amplitude de la dentelure',
                                     0.0, 500.0, 12.0, RW)
            proc.add_double_argument('rim', '_Frange blanche (px)', 'Largeur de la frange de papier',
                                     0.0, 200.0, 7.0, RW)
            proc.add_double_argument('roughness', '_Rugosité (%)', 'Finesse des fibres', 0.0, 100.0, 60.0, RW)
            proc.add_int_argument('seed', '_Graine', 'Change la forme de la déchirure', 0, 1000000, 7, RW)
            proc.add_color_argument('paper-color', 'Couleur du _papier', 'Âme du papier',
                                    False, Gegl.Color.new('#fbfbf8'), RW)
            proc.add_double_argument('shadow', '_Ombre (%)', 'Opacité des ombres', 0.0, 100.0, 40.0, RW)
            # bords
            proc.add_boolean_argument('side-top', 'Bord _haut', 'Déchirer le haut', False, RW)
            proc.add_boolean_argument('side-right', 'Bord _droit', 'Déchirer la droite', False, RW)
            proc.add_boolean_argument('side-bottom', 'Bord _bas', 'Déchirer le bas', True, RW)
            proc.add_boolean_argument('side-left', 'Bord _gauche', 'Déchirer la gauche', False, RW)
            # trou
            proc.add_double_argument('hole-x', 'Trou : centre X (%)', '', 0.0, 100.0, 50.0, RW)
            proc.add_double_argument('hole-y', 'Trou : centre Y (%)', '', 0.0, 100.0, 50.0, RW)
            proc.add_double_argument('hole-width', 'Trou : largeur (%)', '', 1.0, 150.0, 60.0, RW)
            proc.add_double_argument('hole-height', 'Trou : hauteur (%)', '', 1.0, 150.0, 22.0, RW)
            proc.add_double_argument('hole-angle', 'Trou : angle (°)', '', -180.0, 180.0, -25.0, RW)
            # bande
            proc.add_double_argument('strip-position', 'Bande : position (%)', '', 0.0, 100.0, 50.0, RW)
            proc.add_double_argument('strip-width', 'Bande : épaisseur (%)', '', 2.0, 100.0, 30.0, RW)
            proc.add_choice_argument('strip-direction', 'Bande : sens', 'Sens de l\'arrachage', _choice([
                ('right', 'Vers la droite'), ('left', 'Vers la gauche'),
                ('down', 'Vers le bas'), ('up', 'Vers le haut')]), 'right', RW)
            proc.add_double_argument('strip-progress', 'Bande : avancement (%)', '', 0.0, 100.0, 70.0, RW)
            proc.add_boolean_argument('strip-roll', 'Bande : dessiner le rouleau', '', True, RW)
            proc.add_double_argument('roll-radius', 'Bande : rayon du rouleau (px, 0 = auto)', '',
                                     0.0, 500.0, 0.0, RW)

        proc.set_image_types('*')
        proc.set_sensitivity_mask(Gimp.ProcedureSensitivityMask.DRAWABLE)
        proc.set_attribution('page-corner_effect', 'MIT', '2026')
        proc.add_menu_path(MENU)
        return proc


Gimp.main(PageEffects.__gtype__, sys.argv)
