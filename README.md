# Page Effects — coin de page qui tourne & papier déchiré

Plugin JavaScript **sans dépendance** (≈ 20 Ko non minifié) pour :

- **PageCurl** : soulever / corner / tourner l'un des 4 coins d'une page (image, carte, bloc HTML…), au survol, au glisser (souris ou tactile) ou par programme, en révélant un contenu placé dessous ;
- **PaperTear** : effets de papier déchiré — **bords déchirés** (`edge`), **trou arraché** (`hole`) et **bande arrachée avec rouleau** (`strip`).

Fonctionne en `<script>`, en module CommonJS/AMD et comme plugin **jQuery** (si jQuery est présent).
Démo : ouvrez `index.html` dans un navigateur.

## Installation

```html
<script src="src/page-effects.js"></script>
```

## Coin de page (PageCurl)

```js
const curl = PageEffects.pageCurl('#photo', {
  corner: 'br',                 // 'tl' | 'tr' | 'bl' | 'br'
  hoverPeel: 70,                // soulèvement au survol (px)
  under: 'images/dessous.jpg'   // ce qui apparaît sous la page
});

curl.peelTo(150);   // soulève le coin de 150 px (ou peelTo({x, y}))
curl.turn();        // tourne entièrement la page
curl.reset();       // revient au repos
```

| Option | Défaut | Rôle |
|---|---|---|
| `corner` | `'br'` | Coin animé : `tl`, `tr`, `bl`, `br` (ou `top-left`, `bottom-right`…) |
| `peel` | `0` | Soulèvement au repos, en px (coin corné permanent si > 0) |
| `hoverPeel` | `60` | Soulèvement au survol du coin |
| `interactive` | `true` | Le coin se tire à la souris / au doigt |
| `turnable` | `true` | Relâcher au-delà du seuil tourne la page |
| `turnThreshold` | `0.35` | Seuil (fraction de la diagonale) |
| `clickToTurn` | `false` | Un clic sur le coin tourne la page (et la remet) |
| `afterTurn` | `'stay'` | `'stay'` ou `'reset'` (la page revient automatiquement) |
| `radius` | auto | Rayon max de la courbure (px) |
| `backColor` | `'#f4f4f1'` | Couleur du verso du papier |
| `shadow` | `0.45` | Opacité des ombres (0 = aucune) |
| `under` | `null` | Élément DOM, chaîne HTML, URL d'image ou couleur / dégradé CSS |
| `hotspot` | `90` | Taille de la zone sensible du coin (px) |
| `duration` | `450` | Durée des animations (ms) |
| `onTurn`, `onChange` | `null` | Rappels (`onChange(progress, instance)`) |

Événements DOM : `pagecurl:turn`, `pagecurl:reset`.

## Papier déchiré (PaperTear)

```js
// Bords déchirés
PageEffects.paperTear('.note', { mode: 'edge', sides: ['top', 'bottom'] });

// Trou arraché révélant un contenu
PageEffects.paperTear('#affiche', {
  mode: 'hole',
  under: '<div class="surprise">Surprise !</div>',
  hole: { x: 0.5, y: 0.5, width: 0.6, height: 0.25, angle: -25 }
});

// Bande arrachée avec rouleau (animable et déplaçable)
const tear = PageEffects.paperTear('#bandeau', {
  mode: 'strip', under: 'images/dessous.jpg',
  strip: { position: 0.5, width: 0.3, direction: 'right', progress: 0 }
});
tear.tearTo(1);          // anime l'arrachage (0..1)
```

| Option | Défaut | Rôle |
|---|---|---|
| `mode` | `'edge'` | `'edge'`, `'hole'` ou `'strip'` |
| `sides` | `'bottom'` | (edge) `'top'`, `'right'`, `'bottom'`, `'left'`, `'all'` ou tableau |
| `depth` | `9` | Amplitude des dentelures (px) |
| `rim` | `6` | Largeur de la frange blanche du papier (px) |
| `roughness` | `0.6` | Finesse des fibres (0..1) |
| `seed` | `7` | Graine : change la forme de la déchirure |
| `paperColor` | `'#fbfbf8'` | Couleur de l'âme du papier |
| `shadow` | `0.35` | Opacité des ombres |
| `under` | `null` | (hole / strip) contenu révélé |
| `hole` | `{x:.5, y:.5, width:.6, height:.22, angle:-25}` | Position / taille relatives du trou |
| `strip` | `{position:.5, width:.3, direction:'right', progress:1, roll:true}` | Bande : position, épaisseur, sens (`right`, `left`, `down`, `up`), avancement |
| `interactive` | `true` | (strip) le rouleau se tire à la souris / au doigt |

Méthodes : `setOptions(opts)`, `refresh()`, `tearTo(p, durée)`, `destroy()`.
Événements DOM : `papertear:progress`, `papertear:complete`.

## Sans JavaScript : attributs `data-`

```html
<img src="photo.jpg" data-page-curl='{"corner":"tr","peel":50}'>
<div data-paper-tear='{"mode":"edge","sides":"all"}'>…</div>
```

Les éléments sont initialisés automatiquement au chargement (ou via `PageEffects.init(conteneur)` pour du contenu ajouté plus tard). `PageEffects.get(el)` renvoie l'instance.

## jQuery

```js
$('.carte').pageCurl({ corner: 'bl', peel: 40 });
$('.carte').pageCurl('turn');          // appel de méthode
$('.note').paperTear({ sides: 'all' });
```

## Fonctionnement

- Le coin est modélisé comme une feuille qui s'enroule autour d'un cylindre puis se rabat à plat : la partie restante de la page est découpée en CSS (`clip-path`), le rabat (verso éclairé, ombres) est dessiné dans un `<canvas>` superposé, ce qui fonctionne avec n'importe quel contenu HTML.
- Les déchirures utilisent un bruit fractal déterministe (même `seed` → même forme) : l'image est découpée en `clip-path`, la frange blanche et l'ombre sont dessinées dessous dans un `<canvas>`.

Navigateurs : versions récentes de Chrome, Edge, Firefox et Safari (`clip-path: path()` requis pour les modes `hole` et `strip`).

## Licence

MIT
