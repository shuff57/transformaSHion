# transformaSHion: Tracing Paper

A coordinate-grid tool for slides, turns and flips. Lay a sheet of tracing paper over a grid, mark points on it,
then slide it, turn it about a center you pick, or flip it over a mirror line you pick. The tool shows where every
mark went. It never names the single move that connects two figures: working that out is the student's job.

No dependencies, no build step to use it. Open `index.html`, or `dist/tracing-paper.html` (one self-contained file).

## What a student can do

- **Lay the paper down**, then **trace the figure** (or mark points by clicking the grid).
- **Slide:** drag the paper, press an arrow key on the grid, or type how far.
- **Turn:** pick a center (click, or type it), set an angle, turn counterclockwise or clockwise.
- **Flip:** pick a mirror (x-axis, y-axis, y = x, `x =` a number, `y =` a number, any two clicked points, or one of the
  setup's own mirrors) and flip the paper. A flipped paper is drawn face down, hatched.
- See a table of every mark (where it was marked, where it is now, how far it moved) and the list of moves so far.
  Undo, or put the paper back.
- **Check a prediction** (when a setup has checks): type the points you expect, get "Matches" or "Does not match yet".
  It never shows the answer.

Works with a mouse, touch and keyboard, in light and dark themes, and respects reduced motion (moves land instantly).

## Use it in your own page

```html
<link rel="stylesheet" href="dist/tracing-paper.css">
<div id="app"></div>
<script src="dist/tracing-paper.js"></script>
<script>
  TracingPaper.mount(document.getElementById("app"), { presets: [ /* see below */ ], preset: "id-to-start-on" });
  // or, as a dialog:  TracingPaper.openModal({ presets: [...], preset: "id", onClose: function () {} });
</script>
```

`mount` returns `{ setPreset(idOrIndex), state(), destroy() }`.

### A setup is plain data

```js
{ id: "parallel", title: "Two flips, parallel mirrors", note: "Shown under the title.",
  xr: [-3, 11], yr: [0, 7],                                   // the grid's x and y range (integers)
  shapes: [{ name: "triangle", pts: [[-1, 1], [-1, 4], [1, 1]], role: "pre", closed: true }],   // role "ref" = dashed outline only
  guides: [{ type: "v", a: 2 }, { type: "v", a: 6 }],         // mirror buttons and faint lines; also "h" (b), "diag", "line" (p, q)
  center: [4, 2],                                             // optional starting center
  checks: [{ label: "After x = 2, then x = 6", answer: [[7, 1], [7, 4], [9, 1]] }] }   // optional; the Check box appears when present
```

`src/presets.js` has seven worked setups (from a high-school geometry unit on rigid motions).

## The plotter: a plain graphing grid (newer style)

`src/plotter.js` and `src/plotter.css` are the same idea laid out like a MyOpenMath graphing question. The grid starts
empty and nothing is pre-drawn: the student plots every figure.

- **Draw:** Line, Dot, Polygon and Eraser, plus Clear All. Clicks snap to grid points.
- **Paper** (the sheet-with-a-dog-ear button): turn it on, then mark points on it (click a grid crossing or a corner; click a polygon's edge to copy the
  whole polygon), and slide, turn or flip the paper. The paper's table and the list of moves stay under the grid.
- **Mark image on grid:** after moving the paper, copies where its marks are now onto the grid as polygons and dots.
- **Grid size:** a row under the tools sets the x and y range (whole numbers, 2 to 60 units each); Reset grid restores the setup's own.
- **Check** (only on a setup that has a hidden `target`): compares the paper's marked points to the target and says only
  "Matches." or "Does not match." The target is never in the page.

```html
<link rel="stylesheet" href="dist/plotter.css">
<div id="app"></div>
<script src="dist/plotter.js"></script>
<script>Plotter.mount(document.getElementById("app"), { presets: Plotter.presets, preset: "parallel" });</script>
```

Presets (`Plotter.presets`): `blank`, `triangle-mirror`, `parallel`, `kite`, `turn`. A preset is plain data:
`{ id, title, xr, yr, note, target }` (`target` optional). On a bookSHelf page, `<div class="pl-inline"
data-plotter-preset="parallel">` builds the grid in place and `[label](#plotter:parallel)` opens it in a dialog.
`dist/plotter.html` is one self-contained file; `dist/bookshelf/plotter.*` is the plugin-loader pair. Tests:
`tests/test_plotter.py` (drives Chromium). The tracing paper above is kept for its setups, which carry their own
shapes, mirrors and checks.

## Files

| | |
|---|---|
| `src/tracing-paper.js` | the tool (math, drawing, controls) |
| `src/tracing-paper.css` | styles; light, dark, and `[data-theme="dark"]` |
| `src/presets.js` | example setups |
| `src/plotter.js`, `src/plotter.css` | the plotter (self-contained: presets, mount, plugin wrapper) |
| `src/bookshelf-plugin.js` | wrapper for the bookSHelf page-plugin loader (not needed elsewhere) |
| `build.py` | writes `dist/` |
| `tests/test_tracing_paper.py` | drives the real UI in Chromium and checks every readout |

## Build and test

```
python3 build.py
pip install pytest playwright && playwright install chromium
python3 -m pytest tests -q
```

The tests check the matrix math and the interface against worked answers (two parallel flips make a slide of twice the
gap; flipping over the x-axis then y = x is a quarter turn counterclockwise, and the reverse order is clockwise; a quarter
turn about a center that is not the origin; the kite). Set `TP_SHOTS=/some/dir` to also write screenshots.

## License

MIT. See `LICENSE`.
