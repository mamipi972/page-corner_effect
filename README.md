# Effets de page / Page Effects — GIMP 3

**[Français](#français)** · **[English](#english)**

![Aperçu des effets rendus par GIMP / Preview of the effects rendered by GIMP](apercu.png)

---

## Français

Plug-in GIMP 3 : effets de **coin de page qui tourne** et de **papier déchiré**.
Plug-in Python 3 (API GObject de GIMP 3), testé avec GIMP 3.2.2.

Après installation, les filtres se trouvent dans **Filtres › Effets de page** :

- **Coin de page…** : soulève et enroule un coin du calque actif ;
- **Papier déchiré…** : bords déchirés, trou arraché ou bande arrachée avec rouleau.

### Installation

1. Repérez le dossier des greffons : *Édition › Préférences › Dossiers › Greffons*. Par défaut :
   - Windows : `%APPDATA%\GIMP\3.0\plug-ins\` (ou `3.2`, selon votre version)
   - macOS : `~/Library/Application Support/GIMP/3.0/plug-ins/`
   - Linux : `~/.config/GIMP/3.0/plug-ins/`
2. Copiez-y **le dossier entier** `page-effects/` (il doit contenir `page-effects.py` et `pe_core.py`).
   Le nom du dossier doit rester identique au nom du fichier `.py`.
3. Linux / macOS : rendez le script exécutable :
   `chmod +x page-effects/page-effects.py`
4. Redémarrez GIMP.

### Utilisation

Les effets sont **non destructifs** : le calque reçoit un **masque de calque**, et le verso de la page,
la frange du papier et les ombres sont créés dans des **calques séparés**, que vous pouvez retoucher,
déplacer ou supprimer. Ce qui apparaît sous la page, c'est **le contenu des calques du dessous** :
placez une autre photo en dessous pour obtenir l'effet « page qui se tourne sur une autre photo ».

#### Coin de page

| Paramètre | Rôle |
|---|---|
| Coin | Bas droit, bas gauche, haut droit, haut gauche |
| Soulèvement (%) | Déplacement du coin, en % de la diagonale (petit = coin corné, 60 %+ = page presque tournée) |
| Angle (°) | Écart par rapport à la diagonale (courbure plus horizontale ou plus verticale) |
| Rayon de courbure | 0 = automatique |
| Couleur du verso | Couleur du dos du papier |
| Ombre (%) | Opacité du calque d'ombre |
| Remplir le dessous | Ajoute un calque de couleur sous la page (sinon : transparence / calques inférieurs) |

Calques créés : *Coin de page — verso*, *Coin de page — ombre* (et *Dessous* si demandé).

#### Papier déchiré

| Paramètre | Rôle |
|---|---|
| Type | Bords déchirés, trou arraché, bande arrachée (rouleau) |
| Profondeur des dents | Amplitude de la dentelure (px) |
| Frange blanche | Largeur de l'âme blanche du papier visible le long de la déchirure |
| Rugosité | Finesse des fibres |
| Graine | Changez-la pour obtenir une autre forme de déchirure |
| Bord haut / droit / bas / gauche | (Bords déchirés) côtés à déchirer |
| Trou : centre, largeur, hauteur, angle | (Trou) position et forme en % du calque |
| Bande : position, épaisseur, sens, avancement, rouleau | (Bande) le rouleau de papier est dessiné au bout de la déchirure |

Calques créés : *Papier déchiré — papier*, *Papier déchiré — ombre*, et pour la bande *Rouleau* / *Rouleau — ombre*.

### Script / traitement par lots

Les procédures sont disponibles dans le PDB (*Filtres › Console Python*) :

```python
pdb = Gimp.get_pdb()
proc = pdb.lookup_procedure('plug-in-pe-page-curl')     # ou 'plug-in-pe-paper-tear'
cfg = proc.create_config()
cfg.set_property('image', image)
cfg.set_core_object_array('drawables', [layer])
cfg.set_property('corner', 'tr')
cfg.set_property('amount', 25.0)
proc.run(cfg)
```

### Remarques

- Sélectionnez **un seul calque de pixels** (pas un groupe) avant de lancer le filtre.
- Si le calque a déjà un masque, la découpe y est ajoutée.
- Le rendu du verso est calculé en Python : sur de très grandes images (> 20 Mpx) avec un fort
  soulèvement, comptez quelques secondes.
- GIMP intègre aussi un ancien filtre *Filtres › Déformations › Recourbement de page* ; celui-ci offre
  une courbure éclairée, les 4 coins, un angle libre et les effets de papier déchiré.

### Licence

MIT

---

## English

GIMP 3 plug-in: **page curl / page turn** and **torn paper** effects.
Python 3 plug-in (GIMP 3 GObject API), tested with GIMP 3.2.2.

Once installed, the filters are under **Filters › Effets de page**:

- **Coin de page…** (*Page curl*): lifts and rolls up a corner of the active layer;
- **Papier déchiré…** (*Torn paper*): torn edges, torn hole, or a torn-off strip with a paper roll.

> The plug-in's menu entries and dialog labels are in French. The tables below give the English
> meaning of each setting next to its French label.

### Installation

1. Find your plug-ins folder: *Edit › Preferences › Folders › Plug-ins*. By default:
   - Windows: `%APPDATA%\GIMP\3.0\plug-ins\` (or `3.2`, depending on your version)
   - macOS: `~/Library/Application Support/GIMP/3.0/plug-ins/`
   - Linux: `~/.config/GIMP/3.0/plug-ins/`
2. Copy **the whole** `page-effects/` folder there (it must contain `page-effects.py` and `pe_core.py`).
   The folder name must stay identical to the `.py` file name.
3. Linux / macOS: make the script executable:
   `chmod +x page-effects/page-effects.py`
4. Restart GIMP.

### Usage

The effects are **non-destructive**: the layer gets a **layer mask**, and the back of the page,
the paper fringe and the shadows are created as **separate layers** that you can edit, move or
delete. Whatever shows under the page is **the content of the layers below**: put another photo
underneath to get the "page turning onto another photo" effect.

#### Page curl (*Coin de page*)

| Setting (French label) | Meaning |
|---|---|
| Coin | Corner: bottom right, bottom left, top right, top left |
| Soulèvement (%) | Curl amount: corner displacement, in % of the diagonal (small = dog-ear, 60 %+ = page almost turned) |
| Angle (°) | Deviation from the diagonal (more horizontal or more vertical curl) |
| Rayon de courbure | Curl radius: 0 = automatic |
| Couleur du verso | Back color: color of the back of the paper |
| Ombre (%) | Shadow: opacity of the shadow layer |
| Remplir le dessous | Fill underneath: adds a color layer below the page (otherwise: transparency / lower layers) |

Layers created: *Coin de page — verso* (back), *Coin de page — ombre* (shadow), and *Dessous* (underneath) if requested.

#### Torn paper (*Papier déchiré*)

| Setting (French label) | Meaning |
|---|---|
| Type | Torn edges, torn hole, torn-off strip (roll) |
| Profondeur des dents | Tooth depth: amplitude of the jagged edge (px) |
| Frange blanche | White fringe: width of the white paper core visible along the tear |
| Rugosité | Roughness: fineness of the fibers |
| Graine | Seed: change it to get a different tear shape |
| Bord haut / droit / bas / gauche | (Torn edges) top / right / bottom / left sides to tear |
| Trou : centre, largeur, hauteur, angle | (Hole) center, width, height, angle, in % of the layer |
| Bande : position, épaisseur, sens, avancement, rouleau | (Strip) position, thickness, direction, progress; the paper roll is drawn at the end of the tear |

Layers created: *Papier déchiré — papier* (paper), *Papier déchiré — ombre* (shadow), and for the strip *Rouleau* / *Rouleau — ombre* (roll / roll shadow).

### Scripting / batch processing

The procedures are available in the PDB (*Filters › Python Console*):

```python
pdb = Gimp.get_pdb()
proc = pdb.lookup_procedure('plug-in-pe-page-curl')     # or 'plug-in-pe-paper-tear'
cfg = proc.create_config()
cfg.set_property('image', image)
cfg.set_core_object_array('drawables', [layer])
cfg.set_property('corner', 'tr')
cfg.set_property('amount', 25.0)
proc.run(cfg)
```

### Notes

- Select **a single pixel layer** (not a group) before running the filter.
- If the layer already has a mask, the cut-out is added to it.
- The back of the page is rendered in Python: on very large images (> 20 MP) with a strong
  curl, allow a few seconds.
- GIMP also ships an older *Filters › Distorts › Page Curl* filter; this plug-in adds a lit curl,
  all 4 corners, a free angle and the torn-paper effects.

### License

MIT
