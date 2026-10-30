/* Plotter: a plain graphing grid for bookSHelf pages, in the style of a graphing question.
 * Laid out like MyOpenMath's graphing question: one toolbar under the grid (Clear All, Draw: Line, Dot, Eraser).
 * An optional translucent Paper starts blank; the student marks points onto it, then slides, turns or flips it.
 * The tool never says which move is right. An optional hidden Check compares the paper's marked points to a target and
 * says only "matches" or "does not match". No dependencies.
 *
 * Page use (the plugin loader mounts this slotless entry into the body):
 *   <div class="pl-inline" data-plotter-preset="parallel"></div>   the tool, built into the page where the div sits
 *   <a href="#plotter:parallel">label</a>   or   <button data-plotter data-plotter-preset="parallel">   opens it in a dialog
 */
(function (root) {
  "use strict";

  /* Presets are plain data: grid range, a note, and an optional hidden `target` (the paper's marked points after the move).
   * A preset with no target shows no Check button. Nothing is pre-drawn: the student plots every figure. */
  var PRESETS = [
    { id: "blank", title: "Graphing grid", xr: [-10, 10], yr: [-10, 10],
      note: "Plot what the problem gives you. Turn on the paper to test a move." },
    { id: "triangle-mirror", title: "Graphing grid", xr: [0, 10], yr: [0, 7],
      note: "Plot the triangle and the mirror line from the coordinates in the step. Mark the corners on the paper, then move the paper.",
      target: [[9, 2], [6, 2], [9, 6]] },
    { id: "parallel", title: "Graphing grid", xr: [-3, 11], yr: [0, 7],
      note: "Plot the triangle and both mirror lines from the coordinates in the step. Mark the corners on the paper, then move the paper.",
      targets: [[[7, 1], [7, 4], [9, 1]], [[5, 1], [5, 4], [7, 1]], [[5, 1], [5, 4], [3, 1]]] },
    { id: "kite", title: "Graphing grid", xr: [0, 40], yr: [0, 22],
      note: "Plot the eight anchor points of the kite. Mark them on the paper, then move the paper." },
    { id: "turn", title: "Graphing grid", xr: [-1, 9], yr: [-2, 8],
      note: "Plot the triangle from the coordinates in the step. Mark the corners on the paper, then move the paper.",
      target: [[4, 5], [0, 2], [2, -1]] },
  ];
  root.PLOTTER_PRESETS = PRESETS;

  var NS = "http://www.w3.org/2000/svg";
  var uid = 0;
  var M = 30;                       // margin around the plot, in viewBox units (room for tick labels)
  var DRAW = ["line", "point", "polygon", "erase"];
  var PAPER = ["mark", "slide", "turn", "flip"];
  var LABEL = { point: "Dot", line: "Line", polygon: "Polygon", erase: "Eraser",
    mark: "Mark on paper", slide: "Slide", turn: "Turn", flip: "Flip", paper: "Paper", settings: "Settings", undo: "Undo", redo: "Redo" };

  function h(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function s(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function num(v) { return Number(v.toFixed(4)); }
  function fmt(v) { var r = Number(v.toFixed(2)); return String(r === 0 ? 0 : r); }
  function pt(p) { return "(" + fmt(p[0]) + ", " + fmt(p[1]) + ")"; }

  /* ---- affine maths: T = [a, b, c, d, e, f], x' = a x + c y + e, y' = b x + d y + f (y up) ---- */
  var I = [1, 0, 0, 1, 0, 0];
  function compose(A, B) {          // A after B
    return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  }
  function apply(T, p) { return [T[0] * p[0] + T[2] * p[1] + T[4], T[1] * p[0] + T[3] * p[1] + T[5]]; }
  function det(T) { return T[0] * T[3] - T[1] * T[2]; }
  function inverse(T) {
    var d = det(T), a = T[3] / d, b = -T[1] / d, c = -T[2] / d, dd = T[0] / d;
    return [a, b, c, dd, -(a * T[4] + c * T[5]), -(b * T[4] + dd * T[5])];
  }
  function translate(dx, dy) { return [1, 0, 0, 1, dx, dy]; }
  function rotateAbout(deg, c) {
    var r = deg * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
    return [co, si, -si, co, c[0] - co * c[0] + si * c[1], c[1] - si * c[0] - co * c[1]];
  }
  function reflectAcross(p, q) {
    var dx = q[0] - p[0], dy = q[1] - p[1], L = Math.sqrt(dx * dx + dy * dy), ux = dx / L, uy = dy / L;
    var a = 2 * ux * ux - 1, b = 2 * ux * uy, d = 2 * uy * uy - 1;
    return [a, b, b, d, p[0] - (a * p[0] + b * p[1]), p[1] - (b * p[0] + d * p[1])];
  }
  function foldScale(p, q, k) {     // squash everything across the line p-q by k: 1 leaves it, 0 is edge-on, -1 is the reflection
    var dx = q[0] - p[0], dy = q[1] - p[1], L = Math.sqrt(dx * dx + dy * dy), ux = dx / L, uy = dy / L;
    var a = ux * ux + k * uy * uy, b = (1 - k) * ux * uy, d = uy * uy + k * ux * ux;
    return [a, b, b, d, p[0] - (a * p[0] + b * p[1]), p[1] - (b * p[0] + d * p[1])];
  }
  function distSeg(px, py, a, b, infinite) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    var t = L2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L2 : 0;
    if (!infinite) t = Math.max(0, Math.min(1, t));
    var x = a[0] + t * dx, y = a[1] + t * dy;
    return Math.sqrt((px - x) * (px - x) + (py - y) * (py - y));
  }

  /* ------------------------------------------------------------------ the tool */
  function mount(host, opts) {
    opts = opts || {};
    var presets = opts.presets && opts.presets.length ? opts.presets : PRESETS;
    var preset = presets[0];
    for (var i = 0; i < presets.length; i++) if (presets[i].id === opts.preset) preset = presets[i];
    var targets = (preset.targets || (preset.target ? [preset.target] : [])).filter(function (t) { return t && t.length; });   // stays in this closure: never written to the DOM
    var id = "pl" + (++uid);

    var S = {
      xr: (preset.xr || [-10, 10]).slice(), yr: (preset.yr || [-10, 10]).slice(), snap: 1,
      tool: "line", items: [], pending: [], hover: null, preview: null, down: false, drag: null,
      paper: false, T: I.slice(), marks: [], outlines: [], moves: [], center: null, hAng: 0, flipFrom: null,
      status: "", kb: null, kbOn: false, turnLive: null,
      names: {}, nameSeq: 0,                 // a letter for every plotted position (A, B, C ...), and how many have been handed out
    };

    host.innerHTML = "";
    host.classList.add("pl-root");
    var root_ = h("section", { class: "pl", "aria-label": "Graphing grid" });
    host.appendChild(root_);
    var Hd = "h" + (opts.headingLevel || 3);
    var title = h(Hd, { class: "pl-title" }, preset.title || "Graphing grid");
    root_.appendChild(title);
    if (preset.note) root_.appendChild(h("p", { class: "pl-note" }, preset.note));

    /* toolbars */
    var ICON = {
      line: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="6" y="15" width="4" height="4" fill="var(--pl-accent)"/><rect x="14" y="5" width="4" height="4" fill="var(--pl-accent)"/></svg>',
      point: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="5.5" fill="currentColor"/></svg>',
      polygon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><polygon points="5,19 12,4 20,16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><rect x="3" y="17" width="4" height="4" fill="var(--pl-accent)"/><rect x="10" y="2" width="4" height="4" fill="var(--pl-accent)"/><rect x="18" y="14" width="4" height="4" fill="var(--pl-accent)"/></svg>',
      paper: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M6 3h8l5 5v13H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5z" fill="var(--pl-accent)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
      undo: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M9 8H4V3M4.5 8A8 8 0 1 1 4 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 1)"/></svg>',
      redo: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M15 8h5V3M19.5 8A8 8 0 1 0 20 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 1)"/></svg>',
      settings: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M9.04 5.00 L9.50 1.80 L14.50 1.80 L14.96 5.00 L14.86 4.96 L17.45 3.02 L20.98 6.55 L19.04 9.14 L19.00 9.04 L22.20 9.50 L22.20 14.50 L19.00 14.96 L19.04 14.86 L20.98 17.45 L17.45 20.98 L14.86 19.04 L14.96 19.00 L14.50 22.20 L9.50 22.20 L9.04 19.00 L9.14 19.04 L6.55 20.98 L3.02 17.45 L4.96 14.86 L5.00 14.96 L1.80 14.50 L1.80 9.50 L5.00 9.04 L4.96 9.14 L3.02 6.55 L6.55 3.02 L9.14 4.96Z M15.2 12a3.2 3.2 0 1 0-6.4 0 3.2 3.2 0 0 0 6.4 0Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
      erase: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M4 15 13 5l7 6-7 8H8z M8 19l-4-4 M10.5 8.5 16.5 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    };
    var btn = {};
    function addBtn(parent, key, label, extra) {
      var b = h("button", { type: "button", class: "pl-btn" + (extra ? " " + extra : ""), "data-key": key }, label);
      parent.appendChild(b); btn[key] = b; return b;
    }
    function iconBtn(parent, key) {
      var b = addBtn(parent, key, "", "pl-tool pl-icon");
      b.innerHTML = ICON[key]; b.setAttribute("aria-label", LABEL[key]); b.setAttribute("title", LABEL[key]);
      b.setAttribute("aria-pressed", "false");
      return b;
    }
    var bar = h("div", { class: "pl-bar", role: "toolbar", "aria-label": "Drawing tools" });
    var svgHolder = h("div", { class: "pl-svgholder" });
    var hint = h("p", { class: "pl-hint", hidden: "" });
    var svg = s("svg", { class: "pl-svg", tabindex: "0", role: "group", "aria-label":
      "Graph grid. Arrow keys move the cursor, Enter places or picks at the cursor, Escape cancels." });
    svgHolder.appendChild(svg);
    var main = h("div", { class: "pl-main" }), side = h("div", { class: "pl-side" });   // the grid, and a right sidebar that holds Settings
    var left = h("div", { class: "pl-left" });                 // left sidebar: the steps (empty, so hidden, on narrow screens where they sit under the grid)
    main.appendChild(left); main.appendChild(svgHolder); main.appendChild(side);
    root_.appendChild(main);
    addBtn(bar, "clear", "Clear All");
    bar.appendChild(h("span", { class: "pl-drawlbl" }, "Draw:"));
    DRAW.forEach(function (k) { iconBtn(bar, k); });
    addBtn(bar, "close", "Close polygon");
    var setBtn = addBtn(side, "settings", "", "pl-icon");
    setBtn.innerHTML = ICON.settings; setBtn.setAttribute("aria-label", LABEL.settings); setBtn.setAttribute("title", LABEL.settings);
    setBtn.setAttribute("aria-expanded", "false"); setBtn.setAttribute("aria-haspopup", "true");
    root_.appendChild(bar);

    /* settings menu: the grid size (the visible x and y range), a panel in the right sidebar: always shown when the screen is wide, an overlay that pops out of the gear when it is narrow */
    var cfg = h("div", { class: "pl-menu pl-cfg", role: "group", "aria-label": "Grid size", hidden: "" });
    var cin = {};
    function cfgField(row, label, key) {
      var lab = h("label", { class: "pl-cfglbl" }, label);
      var inp = h("input", { type: "number", step: "1", class: "pl-num", "data-cfg": key, "aria-label": label });
      lab.appendChild(inp); cin[key] = inp; row.appendChild(lab);
    }
    cfg.appendChild(h("p", { class: "pl-menutitle" }, "Grid size"));
    var rowX = h("div", { class: "pl-menurow" }), rowY = h("div", { class: "pl-menurow" }), rowB = h("div", { class: "pl-menurow pl-cfgbtns" });
    cfgField(rowX, "x from", "x0"); cfgField(rowX, "to", "x1"); cfgField(rowY, "y from", "y0"); cfgField(rowY, "to", "y1");
    cfg.appendChild(rowX); cfg.appendChild(rowY); cfg.appendChild(rowB);
    addBtn(rowB, "setgrid", "Set grid");
    addBtn(rowB, "resetgrid", "Reset grid");
    var cfgMsg = h("p", { class: "pl-cfgmsg", role: "status", "aria-live": "polite" });
    cfg.appendChild(cfgMsg);
    side.appendChild(cfg);

    var pbar = h("div", { class: "pl-bar pl-pbar", role: "toolbar", "aria-label": "Paper tools" });
    pbar.appendChild(h("p", { class: "pl-pbartitle" }, "Paper"));      // shown only when the toolbar is a card in the left sidebar (wide screens)
    var phead = h("div", { class: "pl-phead" });                       // Paper title, Undo, Redo and the toggle share one row
    pbar.appendChild(phead); phead.appendChild(pbar.firstChild);
    var undoBtn = addBtn(phead, "undo", "", "pl-icon"), redoBtn = addBtn(phead, "redo", "", "pl-icon");
    undoBtn.innerHTML = ICON.undo; redoBtn.innerHTML = ICON.redo;
    [[undoBtn, "undo"], [redoBtn, "redo"]].forEach(function (a) { a[0].setAttribute("aria-label", LABEL[a[1]]); a[0].setAttribute("title", LABEL[a[1]]); });
    var paperBtn = addBtn(phead, "paper", "", "pl-icon");               // the paper toggle sits with the paper tools; the other tools show only while the paper is on
    paperBtn.innerHTML = ICON.paper + '<span class="pl-togt">Off</span>'; paperBtn.setAttribute("aria-label", LABEL.paper); paperBtn.setAttribute("title", LABEL.paper);
    paperBtn.setAttribute("aria-pressed", "false");
    PAPER.forEach(function (k) { addBtn(pbar, k, LABEL[k], "pl-tool").setAttribute("aria-pressed", "false"); });
    var ccw = addBtn(pbar, "ccw", "\u21BA 15\u00B0"); ccw.setAttribute("aria-label", "Turn paper 15 degrees counterclockwise");
    var cw = addBtn(pbar, "cw", "\u21BB 15\u00B0"); cw.setAttribute("aria-label", "Turn paper 15 degrees clockwise");
    addBtn(pbar, "reset", "Reset paper");
    addBtn(pbar, "clearmarks", "Clear marks");
    addBtn(pbar, "togrid", "Mark image on grid");
    if (targets.length) addBtn(pbar, "check", "Check", "pl-primary");
    root_.appendChild(pbar);
    root_.appendChild(hint);

    var status = h("p", { class: "pl-status", role: "status", "aria-live": "polite" });
    root_.appendChild(status);
    var movesBox = h("div", { class: "pl-movesbox", hidden: "" });
    movesBox.appendChild(h("p", { class: "pl-movesh" }, "Steps"));
    var movesEmpty = h("p", { class: "pl-movesempty" }, "Turn on the paper, then slide, turn or flip it. Each move is listed here.");
    var movesList = h("ol", { class: "pl-moves" });
    movesBox.appendChild(movesEmpty); movesBox.appendChild(movesList);
    root_.appendChild(movesBox);

    /* ---- geometry between data and the drawing ---- */
    var U = 22;
    function layout() {
      var xs = S.xr[1] - S.xr[0], ys = S.yr[1] - S.yr[0];
      U = Math.max(8, Math.min(26, Math.floor(440 / Math.max(xs, ys * 1.15))));
    }
    function X(x) { return M + (x - S.xr[0]) * U; }
    function Y(y) { return M + (S.yr[1] - y) * U; }
    /* Tick numbers scale with the unit, because the corner is the constraint: the y "-1"
       ends 3 units left of the axis and the x "-1" is centred one unit left of it, so
       "−1" must be narrower than (U-3)/1.5 units to clear it. At U=16 a 13px label is
       3 units too wide and the pair overlapped on IM1 3.1; 10px clears it. */
    function tickFs() { return Math.max(8, Math.min(13, (U - 3) / 1.3)); }
    function W() { return M * 2 + (S.xr[1] - S.xr[0]) * U; }
    function Hh() { return M * 2 + (S.yr[1] - S.yr[0]) * U; }
    function snapV(v, lo, hi) {
      var st = S.snap, r = Math.round(v / st) * st;
      return num(Math.max(lo, Math.min(hi, r)));
    }
    function toDraw(e) {             // pointer -> drawing units
      var r = svg.getBoundingClientRect(), k = W() / r.width;
      return [(e.clientX - r.left) * k, (e.clientY - r.top) * k, k];
    }
    function toData(d) { return [S.xr[0] + (d[0] - M) / U, S.yr[1] - (d[1] - M) / U]; }
    function snapPt(d) {
      var p = toData(d);
      return [snapV(p[0], S.xr[0], S.xr[1]), snapV(p[1], S.yr[0], S.yr[1])];
    }
    function tol(d) { return 15 * d[2]; }     // 15 screen pixels, in drawing units

    /* ---- hit tests (drawing units) ---- */
    function segsOf(it) {
      var p = it.pts;
      if (it.kind === "segment" || it.kind === "line") return [[p[0], p[1]]];
      if (it.kind === "polygon") { var out = []; for (var i = 0; i < p.length; i++) out.push([p[i], p[(i + 1) % p.length]]); return out; }
      return [];
    }
    function itemDist(it, d) {
      var best = 1e9, i;
      if (it.kind === "point") return Math.hypot(d[0] - X(it.pts[0][0]), d[1] - Y(it.pts[0][1]));
      for (i = 0; i < it.pts.length; i++) best = Math.min(best, Math.hypot(d[0] - X(it.pts[i][0]), d[1] - Y(it.pts[i][1])));
      segsOf(it).forEach(function (sg) {
        best = Math.min(best, distSeg(d[0], d[1], [X(sg[0][0]), Y(sg[0][1])], [X(sg[1][0]), Y(sg[1][1])], it.kind === "line"));
      });
      return best;
    }
    function pickItem(d, lineOnly) {
      var best = null, bd = tol(d);
      S.items.forEach(function (it) {
        if (lineOnly && it.kind === "point") return;
        var dd = itemDist(it, d) - (it.kind === "point" ? 4 : 0);
        if (dd <= bd) { bd = dd; best = it; }
      });
      return best;
    }
    function pickMark(d) {
      var best = -1, bd = tol(d);
      S.marks.forEach(function (m, i) {
        var g = apply(S.T, m), dd = Math.hypot(d[0] - X(g[0]), d[1] - Y(g[1]));
        if (dd <= bd) { bd = dd; best = i; }
      });
      return best;
    }

    /* ---- actions ---- */
    function setStatus(t, kind) { S.status = t || ""; S.kind = t ? (kind || "") : ""; }
    function cancelPending() { S.pending = []; S.flipFrom = null; S.preview = null; }
    function selectTool(t) {
      S.tool = t; cancelPending(); S.down = false; setStatus("");
      render();
    }
    function nk(q) { return num(q[0]) + "," + num(q[1]); }
    function letter(i) {                                          // 0 -> A ... 25 -> Z, 26 -> AA
      var out = "", n = i + 1, r;
      while (n > 0) { r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
      return out;
    }
    function nameAt(q) { var k = nk(q); return S.names[k] || (S.names[k] = letter(S.nameSeq++)); }
    function addItem(kind, pts) {
      if (kind !== "line") pts.forEach(nameAt);                  // dots and polygon corners are named; a line is not
      S.items.push({ id: ++uid, kind: kind, pts: pts });
    }
    function hasPoint(p) {
      return S.items.some(function (it) { return it.kind === "point" && it.pts[0][0] === p[0] && it.pts[0][1] === p[1]; });
    }
    function logMove(m) {
      var last = S.moves[S.moves.length - 1];
      if (m.kind === "slide" && last && last.kind === "slide") {
        last.dx += m.dx; last.dy += m.dy;
        if (last.dx === 0 && last.dy === 0) S.moves.pop();
      } else if (m.kind === "turn" && last && last.kind === "turn" && last.c[0] === m.c[0] && last.c[1] === m.c[1]) {
        last.deg += m.deg;
        if (last.deg === 0) S.moves.pop();
      } else S.moves.push(m);
    }
    function moveText(m) {
      if (m.kind === "slide") {
        var parts = [];
        if (m.dx) parts.push(fmt(Math.abs(m.dx)) + (m.dx > 0 ? " right" : " left"));
        if (m.dy) parts.push(fmt(Math.abs(m.dy)) + (m.dy > 0 ? " up" : " down"));
        return "Slid " + parts.join(", ");
      }
      if (m.kind === "turn") return "Turned " + Math.abs(m.deg) + " degrees " + (m.deg > 0 ? "counterclockwise" : "clockwise") + " about " + pt(m.c);
      return "Flipped over the line through " + pt(m.p) + " and " + pt(m.q);
    }
    function turnBy(deg) {
      if (!S.center || !deg) return;
      S.T = compose(rotateAbout(deg, S.center), S.T);
      S.hAng += deg;
      logMove({ kind: "turn", deg: deg, c: S.center.slice() });
      setStatus(moveText({ kind: "turn", deg: deg, c: S.center }) + ".");
    }
    function slideBy(dx, dy) {
      if (!dx && !dy) return;
      S.T = compose(translate(dx, dy), S.T);
      logMove({ kind: "slide", dx: dx, dy: dy });
      setStatus(moveText({ kind: "slide", dx: dx, dy: dy }) + ".");
    }
    var folding = false, reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: true };
    function foldAnim(T0, p, q, T1) {      // the paper folds over the line: it narrows to an edge, then opens out face down
      var t0 = null, dur = 650;
      folding = true; S.T = T0;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var k = Math.min(1, (ts - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        S.T = k >= 1 ? T1 : compose(foldScale(p, q, Math.cos(Math.PI * e)), T0);
        if (k >= 1) folding = false;
        render();
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    /* undo / redo of what happens on the paper: its position, the moves, the marks and the copied polygons */
    function pkey() {
      return JSON.stringify([S.T.map(function (n) { return Math.round(n * 1e6) / 1e6; }), S.moves, S.marks.map(function (m) { return [m[0], m[1], m.label]; }), S.outlines]);
    }
    function copyMarks(list) { return list.map(function (m) { var c = m.slice(); c.label = m.label; c.primes = m.primes; return c; }); }
    function pstate() {
      return { T: S.T.slice(), moves: JSON.parse(JSON.stringify(S.moves)), outlines: JSON.parse(JSON.stringify(S.outlines)), marks: copyMarks(S.marks) };
    }
    var hist = [{ key: pkey(), st: pstate() }], hi = 0;
    function track() {                                           // called on every draw: a change to the paper becomes a new step
      if (folding || S.down || S.drag || S.turnLive) return;
      var k = pkey();
      if (k === hist[hi].key) return;
      hist.length = hi + 1; hist.push({ key: k, st: pstate() });
      if (hist.length > 200) hist.shift();
      hi = hist.length - 1;
    }
    function goHist(i) {
      var st = hist[i].st; hi = i;
      S.T = st.T.slice(); S.moves = JSON.parse(JSON.stringify(st.moves)); S.outlines = JSON.parse(JSON.stringify(st.outlines)); S.marks = copyMarks(st.marks);
      S.center = null; S.hAng = 0; S.flipFrom = null;
    }
    function foldOver(p, q) {
      if (p[0] === q[0] && p[1] === q[1]) { setStatus("Pick two different points."); return; }
      var T0 = S.T;
      S.T = compose(reflectAcross(p, q), S.T);
      if (!reduceMotion.matches && window.requestAnimationFrame) foldAnim(T0, p, q, S.T);
      S.center = null; S.hAng = 0; S.flipFrom = null;
      logMove({ kind: "flip", p: p, q: q });
      setStatus(moveText({ kind: "flip", p: p, q: q }) + ".");
    }

    function tap(p, d) {           // p: snapped data point, d: drawing-unit position of the pointer
      setStatus("");
      var t = S.tool, it, i;
      if (!S.paper && PAPER.indexOf(t) >= 0) return;
      if (t === "point") {
        if (!hasPoint(p)) addItem("point", [p]);
      } else if (t === "line") {
        if (!S.pending.length) { S.pending = [p]; }
        else if (S.pending[0][0] === p[0] && S.pending[0][1] === p[1]) setStatus("");
        else { addItem("line", [S.pending[0], p]); S.pending = []; }
      } else if (t === "polygon") {
        var pe = S.pending;
        if (pe.length >= 3 && pe[0][0] === p[0] && pe[0][1] === p[1]) closePolygon();
        else if (!(pe.length && pe[pe.length - 1][0] === p[0] && pe[pe.length - 1][1] === p[1])) pe.push(p);
      } else if (t === "erase") {
        it = pickItem(d);
        if (it) S.items.splice(S.items.indexOf(it), 1);
        else if (S.paper && (i = pickMark(d)) >= 0) S.marks.splice(i, 1);
      } else if (t === "mark") {
        var poly = null;
        S.items.forEach(function (it2) {
          if (it2.kind !== "polygon" || poly) return;
          if (it2.pts.some(function (c) { return c[0] === p[0] && c[1] === p[1]; })) return;       // a corner click copies just that corner
          if (itemDist(it2, d) <= tol(d)) poly = it2;
        });
        if (poly) {
          poly.pts.forEach(markPoint);
          var inv2 = poly.pts.map(function (c) { return apply(inverse(S.T), c); });
          var key2 = inv2.map(function (c) { return c[0].toFixed(5) + "," + c[1].toFixed(5); }).join(";");
          if (!S.outlines.some(function (o) { return o.key === key2; })) S.outlines.push({ key: key2, pts: inv2 });
          setStatus("Copied the polygon onto the paper.");
        } else { markPoint(p); setStatus("Marked " + pt(p) + " on the paper."); }
      } else if (t === "turn") {
        S.center = p; S.hAng = 0; setStatus("Turn center at " + pt(p) + ".");
      } else if (t === "flip") {
        if (S.flipFrom) { foldOver(S.flipFrom, p); }
        else {
          it = pickItem(d, true);
          if (it && it.kind !== "point") {
            var sgs = segsOf(it), best = sgs[0], bd = 1e9;
            sgs.forEach(function (sg) {
              var dd = distSeg(d[0], d[1], [X(sg[0][0]), Y(sg[0][1])], [X(sg[1][0]), Y(sg[1][1])], it.kind === "line");
              if (dd < bd) { bd = dd; best = sg; }
            });
            foldOver(best[0], best[1]);
          } else { S.flipFrom = p; setStatus("First point " + pt(p) + ". Pick a second point."); }
        }
      }
    }
    function closePolygon() {
      if (S.pending.length < 3) return;
      addItem("polygon", S.pending.slice());
      S.pending = [];
    }
    function markPoint(p) {
      var dup = S.marks.some(function (m) {
        var g = apply(S.T, m); return Math.abs(g[0] - p[0]) < 1e-6 && Math.abs(g[1] - p[1]) < 1e-6; });
      if (dup) return;
      var m = apply(inverse(S.T), p);
      m.label = nameAt(p); m.primes = 0;                          // a mark keeps the name of the point it was copied from; each image marked on the grid adds a prime
      S.marks.push(m);
    }

    function markImageOnGrid() {      // copy where the paper's marks are now onto the grid, as polygons and dots
      if (!S.marks.length) { setStatus("Mark some points on the paper first."); return; }
      var inv = inverse(S.T), polyCorners = [], added = 0;
      var cur = function (m) { var g = apply(S.T, m); return [num(g[0]), num(g[1])]; };
      var same = function (a, b) { return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6; };
      var image = {}, primed = [];                                // where each mark is now -> its name with one more prime
      S.marks.forEach(function (m) { image[nk(cur(m))] = m; });
      function nameImage(q) {                                     // a new image point gets A', then A'' the next time; a spot that already has a name keeps it
        var m = image[nk(q)];
        if (m && !S.names[nk(q)]) { S.names[nk(q)] = m.label + new Array(m.primes + 2).join("'"); primed.push(m); }
      }
      S.outlines.forEach(function (o) {
        var pts = o.pts.map(function (c) { var g = apply(S.T, c); return [num(g[0]), num(g[1])]; });
        pts.forEach(function (q) { polyCorners.push(q); });
        pts.forEach(nameImage);
        var dup = S.items.some(function (it) {
          return it.kind === "polygon" && it.pts.length === pts.length && pts.every(function (q, i) { return same(q, it.pts[i]); });
        });
        if (!dup) { addItem("polygon", pts); added++; }
      });
      S.marks.forEach(function (m) {
        var q = cur(m);
        if (polyCorners.some(function (c) { return same(c, q); }) || hasPoint(q)) return;
        nameImage(q); addItem("point", [q]); added++;
      });
      primed.forEach(function (m) { m.primes++; });
      setStatus(added ? "Marked the image on the grid." : "The image is already on the grid.");
    }
    function applyGrid() {
      var v = {};
      for (var k in cin) v[k] = cin[k].value.trim() === "" ? NaN : Number(cin[k].value);
      var bad = ["x0", "x1", "y0", "y1"].some(function (k) { return !isFinite(v[k]) || v[k] !== Math.round(v[k]); });
      if (bad) { cfgMsg.textContent = "Use whole numbers."; return false; }
      if (v.x1 - v.x0 < 2 || v.y1 - v.y0 < 2) { cfgMsg.textContent = "Each range needs at least 2 units."; return false; }
      if (v.x1 - v.x0 > 60 || v.y1 - v.y0 > 60) { cfgMsg.textContent = "Each range can be at most 60 units."; return false; }
      S.xr = [v.x0, v.x1]; S.yr = [v.y0, v.y1]; S.kb = null; S.kbOn = false; cancelPending();
      cfgMsg.textContent = "Grid set to x " + v.x0 + " to " + v.x1 + ", y " + v.y0 + " to " + v.y1 + ".";
      return true;
    }
    function check() {
      if (!S.marks.length) { setStatus("Mark some points on the paper, then check.", "check"); return; }
      var cur = S.marks.map(function (m) { return apply(S.T, m); });
      var key = function (p) { return Math.round(p[0] * 1e4) + "," + Math.round(p[1] * 1e4); };
      var a = cur.map(key).sort();
      var same = targets.some(function (t) {                      // any one of the preset's right answers
        var b = t.map(key).sort();
        return a.length === b.length && a.every(function (v, i) { return v === b[i]; });
      });
      setStatus(same ? "Matches." : "Does not match.", "check");
    }

    /* ---- drawing ---- */
    function render() {
      track();
      layout();
      var w = W(), hgt = Hh(), x0 = S.xr[0], x1 = S.xr[1], y0 = S.yr[0], y1 = S.yr[1];
      svg.setAttribute("viewBox", "0 0 " + w + " " + hgt);
      svg.setAttribute("data-u", U); svg.setAttribute("data-m", M);
      svg.setAttribute("data-xmin", x0); svg.setAttribute("data-xmax", x1);
      svg.setAttribute("data-ymin", y0); svg.setAttribute("data-ymax", y1);
      svg.setAttribute("data-tool", S.tool);
      svg.classList.toggle("pl-drag", S.tool === "slide" || S.tool === "turn");
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var cid = id + "-clip";
      var defs = s("defs", null, svg);
      var cp = s("clipPath", { id: cid }, defs);
      s("rect", { x: M, y: M, width: w - 2 * M, height: hgt - 2 * M }, cp);
      var g = s("g", { class: "pl-gridg" }, svg), v;
      for (v = Math.ceil(x0); v <= x1; v++) s("line", { class: "pl-grid", x1: X(v), y1: Y(y1), x2: X(v), y2: Y(y0) }, g);
      for (v = Math.ceil(y0); v <= y1; v++) s("line", { class: "pl-grid", x1: X(x0), y1: Y(v), x2: X(x1), y2: Y(v) }, g);
      s("rect", { class: "pl-frame", x: M, y: M, width: w - 2 * M, height: hgt - 2 * M }, g);
      var ax = Math.max(x0, Math.min(x1, 0)), ay = Math.max(y0, Math.min(y1, 0));
      s("line", { class: "pl-axis", x1: X(x0), y1: Y(ay), x2: X(x1), y2: Y(ay) }, g);
      s("line", { class: "pl-axis", x1: X(ax), y1: Y(y1), x2: X(ax), y2: Y(y0) }, g);
      var sx = U >= 16 ? 1 : U >= 9 ? 2 : 5, sy = sx, tx;
      for (v = Math.ceil(x0); v <= x1; v++) s("line", { class: "pl-tickmark", x1: X(v), y1: Y(ay) - 4, x2: X(v), y2: Y(ay) + 4 }, g);
      for (v = Math.ceil(y0); v <= y1; v++) s("line", { class: "pl-tickmark", x1: X(ax) - 4, y1: Y(v), x2: X(ax) + 4, y2: Y(v) }, g);
      /* Number placement, measured at the origin corner. The origin "0" sits in the
         y-label row hugged against the axis, and the x labels drop one row below the
         tick marks: at 13px the old "0" (18 below the axis) and the y "-1" (6 below
         its own gridline) were only 7 units apart and their glyphs overlapped. */
      for (v = Math.ceil(x0); v <= x1; v++) {
        if (v % sx !== 0) continue;
        var tstyle = "font-size:" + tickFs().toFixed(1) + "px";
        if (v === 0 && ax === 0 && ay === 0) tx = s("text", { class: "pl-tick", x: X(0) - 3, y: Y(ay) + 6, "text-anchor": "end", style: tstyle }, g);
        else if (v === 0) tx = s("text", { class: "pl-tick", x: X(v), y: Y(ay) + 22, "text-anchor": "middle", style: tstyle }, g);
        else tx = s("text", { class: "pl-tick", x: X(v), y: Y(ay) + 22, "text-anchor": "middle", style: tstyle }, g);
        tx.textContent = v;
      }
      for (v = Math.ceil(y0); v <= y1; v++) {
        if (v % sy !== 0 || (v === 0 && ax === 0 && ay === 0)) continue;
        s("text", { class: "pl-tick", x: X(ax) - 3, y: Y(v) + 6, "text-anchor": "end", style: "font-size:" + tickFs().toFixed(1) + "px" }, g).textContent = v;
      }
      s("text", { class: "pl-axl", x: X(x1) - 2, y: Y(ay) - 6, "text-anchor": "end", style: "font-size:" + (tickFs() + 2).toFixed(1) + "px" }, g).textContent = "x";
      s("text", { class: "pl-axl", x: X(ax) + 7, y: Y(y1) + 12, style: "font-size:" + (tickFs() + 2).toFixed(1) + "px" }, g).textContent = "y";

      /* things the student drew */
      var gi = s("g", { class: "pl-items", "clip-path": "url(#" + cid + ")" }, svg);
      S.items.forEach(function (it) {
        var ig = s("g", { class: "pl-item", "data-kind": it.kind, "data-pts": it.pts.map(function (p) { return p[0] + "," + p[1]; }).join(";") }, gi);
        var p = it.pts, i;
        if (it.kind === "line") {
          var dx = p[1][0] - p[0][0], dy = p[1][1] - p[0][1], L = Math.hypot(dx, dy) || 1, k = 400 / L;
          s("line", { class: "pl-shape", x1: X(p[0][0] - dx * k), y1: Y(p[0][1] - dy * k), x2: X(p[0][0] + dx * k), y2: Y(p[0][1] + dy * k) }, ig);
        } else if (it.kind === "polygon") {
          s("polygon", { class: "pl-shape pl-fill", points: p.map(function (q) { return X(q[0]) + "," + Y(q[1]); }).join(" ") }, ig);
        }
        for (i = 0; i < p.length; i++) {
          if (it.kind === "point") s("circle", { class: "pl-dot", cx: X(p[i][0]), cy: Y(p[i][1]), r: 6 }, ig);
          else s("rect", { class: "pl-anchor", x: X(p[i][0]) - 4.5, y: Y(p[i][1]) - 4.5, width: 9, height: 9 }, ig);
        }
      });

      /* names of the plotted points: letters, and primes on an image marked from the paper */
      var lg = s("g", { class: "pl-labels" }, svg), seen = {};
      S.items.forEach(function (it) {
        if (it.kind === "line") return;
        var cx = 0, cy = 0;
        it.pts.forEach(function (q) { cx += X(q[0]) / it.pts.length; cy += Y(q[1]) / it.pts.length; });
        it.pts.forEach(function (q) {
          var k = nk(q), lbl = S.names[k], dx = 1, dy = -1, L;
          if (!lbl || seen[k]) return;
          seen[k] = 1;
          if (it.kind === "polygon") { dx = X(q[0]) - cx; dy = Y(q[1]) - cy; }   // a corner's name sits outside the polygon
          L = Math.hypot(dx, dy) || 1;
          var tx = s("text", { class: "pl-plbl", x: X(q[0]) + dx / L * 15, y: Y(q[1]) + dy / L * 15, "text-anchor": "middle", "dominant-baseline": "central", "data-name": lbl }, lg);
          tx.textContent = lbl;
        });
      });

      /* the paper */
      if (S.paper) {
        var gp = s("g", { class: "pl-paperg", "clip-path": "url(#" + cid + ")" }, svg);
        var ins = Math.min(2, (x1 - x0) / 4, (y1 - y0) / 4);          // the sheet is 2 units short of the grid on every side, so it never reads as a tint on the background
        var cs = [[x0 + ins, y0 + ins], [x1 - ins, y0 + ins], [x1 - ins, y1 - ins], [x0 + ins, y1 - ins]].map(function (c) { return apply(S.T, c); });
        var back = det(S.T) < 0;
        var sheet = s("polygon", { class: "pl-sheet" + (back ? " pl-back" : ""), "data-side": back ? "back" : "front",
          "data-t": S.T.map(function (n) { return Number(n.toFixed(6)); }).join(","),
          points: cs.map(function (c) { return X(c[0]) + "," + Y(c[1]); }).join(" ") }, gp);
        S.outlines.forEach(function (o) {
          s("polygon", { class: "pl-markpoly", "data-n": o.pts.length, points: o.pts.map(function (c) { var q = apply(S.T, c); return X(q[0]) + "," + Y(q[1]); }).join(" ") }, gp);
        });
        S.marks.forEach(function (m) {
          var q = apply(S.T, m), c = s("circle", { class: "pl-mark", cx: X(q[0]), cy: Y(q[1]), r: 6.5,
            "data-x": Number(q[0].toFixed(4)), "data-y": Number(q[1].toFixed(4)) }, gp);
          s("title", null, c).textContent = "Paper mark at " + pt(q);
        });
      }

      svg.appendChild(lg);                                        // the names stay above the paper's tint

      /* what is in progress */
      var go = s("g", { class: "pl-over" }, svg), cur = S.preview;
      if (S.tool === "polygon" && S.pending.length > 1) s("polyline", { class: "pl-pendline", points: S.pending.map(function (q) { return X(q[0]) + "," + Y(q[1]); }).join(" ") }, go);
      S.pending.forEach(function (q) {
        s("rect", { class: "pl-anchor pl-pend", x: X(q[0]) - 4.5, y: Y(q[1]) - 4.5, width: 9, height: 9 }, go);
      });
      if (S.flipFrom) s("circle", { class: "pl-pdot", cx: X(S.flipFrom[0]), cy: Y(S.flipFrom[1]), r: 6 }, go);
      if (S.paper && S.center) {
        s("circle", { class: "pl-center", cx: X(S.center[0]), cy: Y(S.center[1]), r: 7 }, go);
        if (S.tool === "turn") {
          var R = 3, ang = (S.hAng + (S.turnLive ? S.turnLive.delta - 0 : 0)) * Math.PI / 180;
          if (S.turnLive) ang = (S.turnLive.h0 + S.turnLive.delta) * Math.PI / 180;
          var hx = S.center[0] + R * Math.cos(ang), hy = S.center[1] + R * Math.sin(ang);
          s("line", { class: "pl-arm", x1: X(S.center[0]), y1: Y(S.center[1]), x2: X(hx), y2: Y(hy) }, go);
          var hd = s("circle", { class: "pl-handle", cx: X(hx), cy: Y(hy), r: 13 }, go);
          s("title", null, hd).textContent = "Turn handle";
          if (S.turnLive) s("text", { class: "pl-deg", x: X(hx) + 16, y: Y(hy) + 5 }, go).textContent = S.turnLive.delta + "°";
        }
      }
      var show = S.kbOn && S.kb ? S.kb : cur;
      if (show) {
        s("circle", { class: "pl-cursor", cx: X(show[0]), cy: Y(show[1]), r: 9 }, go);
        var tt = s("text", { class: "pl-clbl", visibility: S.kbOn ? "visible" : "hidden", x: Math.min(w - M - 4, X(show[0]) + 12), y: Math.max(M + 12, Y(show[1]) - 12) }, go);
        tt.textContent = pt(show);
        if (X(show[0]) + 12 > w - M - 70) { tt.setAttribute("x", X(show[0]) - 12); tt.setAttribute("text-anchor", "end"); }
      }

      /* toolbar state */
      Object.keys(btn).forEach(function (k) {
        if (DRAW.indexOf(k) >= 0 || PAPER.indexOf(k) >= 0) btn[k].setAttribute("aria-pressed", S.tool === k ? "true" : "false");
      });
      paperBtn.setAttribute("aria-pressed", S.paper ? "true" : "false");
      paperBtn.querySelector(".pl-togt").textContent = S.paper ? "On" : "Off";
      Array.prototype.forEach.call(pbar.querySelectorAll("button"), function (b) { if (b !== paperBtn) b.hidden = !S.paper; });
      btn.close.hidden = !(S.tool === "polygon" && S.pending.length >= 3);
      btn.ccw.hidden = btn.cw.hidden = !(S.paper && S.tool === "turn" && S.center);
      btn.clear.disabled = !S.items.length && !S.pending.length;
      undoBtn.disabled = hi <= 0; redoBtn.disabled = hi >= hist.length - 1;
      btn.reset.disabled = !S.moves.length && !S.center;
      btn.clearmarks.disabled = !S.marks.length;
      btn.togrid.disabled = !S.marks.length;
      if (document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute("data-cfg")) { /* keep what the reader is typing */ }
      else { cin.x0.value = S.xr[0]; cin.x1.value = S.xr[1]; cin.y0.value = S.yr[0]; cin.y1.value = S.yr[1]; }
      hint.textContent = S.paper ? hintText() : "";
      hint.hidden = !S.paper || !hint.textContent;
      status.textContent = S.paper ? S.status : "";
      status.setAttribute("data-kind", S.paper ? S.kind || "" : "");
      var q;
      var hasMoves = !!(S.paper && S.moves.length);
      movesBox.hidden = !hasMoves; movesEmpty.hidden = hasMoves;      // wide screens always show the Steps panel (CSS), with the note until there is a move
      while (movesList.firstChild) movesList.removeChild(movesList.firstChild);
      S.moves.forEach(function (m) { movesList.appendChild(h("li", null, moveText(m))); });
      alignSide();
    }
    /* The drawing keeps a margin M around the grid for the tick numbers, so the visible grid starts below the svg's top edge.
       Drop the sidebar by that margin (scaled to the rendered size) so its top meets the top of the grid. */
    function alignSide() {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var k = r.width / W();
      side.style.marginTop = left.style.marginTop = "calc(0.4rem + " + (M * k).toFixed(1) + "px)";
      left.style.maxHeight = Math.max(0, r.height - 2 * M * k).toFixed(1) + "px";   // the left column is never taller than the visible grid; the Steps card scrolls inside it
    }
    if (window.ResizeObserver) new ResizeObserver(alignSide).observe(svg); else window.addEventListener("resize", alignSide);
    function hintText() {
      switch (S.tool) {
        case "mark": return "Mark on paper: click a grid crossing or a corner to copy it onto the paper. Click a polygon's edge to copy the whole polygon.";
        case "slide": return "Slide: drag the paper. Or hold Shift and use the arrow keys.";
        case "turn": return S.center ? "Turn: drag the round handle to turn the paper about " + pt(S.center) + ". It snaps to 15 degrees. Click another crossing to move the center."
          : "Turn: click a grid crossing to be the turn center.";
        case "flip": return "Flip: click a line on the grid, or click two grid points, to fold the paper over that line.";
      }
      return "";
    }

    /* ---- pointer ---- */
    svg.addEventListener("pointerdown", function (e) {
      if (e.button > 0 || folding) return;
      S.kbOn = false;
      var d = toDraw(e);
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointers */ }
      if (S.paper && S.tool === "slide") {
        var p0 = toData(d);
        S.drag = { type: "slide", p0: p0, T0: S.T.slice(), dx: 0, dy: 0 };
        e.preventDefault(); return;
      }
      if (S.paper && S.tool === "turn" && S.center && e.target.closest && e.target.closest(".pl-handle")) {
        var c = toData(d), a = Math.atan2(c[1] - S.center[1], c[0] - S.center[0]) * 180 / Math.PI;
        S.drag = { type: "turn", T0: S.T.slice(), prev: a, acc: 0 };
        S.turnLive = { delta: 0, h0: S.hAng };
        e.preventDefault(); render(); return;
      }
      if (!S.paper && PAPER.indexOf(S.tool) >= 0) return;
      S.down = true; S.preview = snapPt(d); render();
    });
    svg.addEventListener("pointermove", function (e) {
      var d = toDraw(e);
      if (S.drag && S.drag.type === "slide") {
        var p = toData(d), st = S.snap;
        var dx = num(Math.round((p[0] - S.drag.p0[0]) / st) * st), dy = num(Math.round((p[1] - S.drag.p0[1]) / st) * st);
        S.drag.dx = dx; S.drag.dy = dy;
        S.T = compose(translate(dx, dy), S.drag.T0);
        setStatus(dx || dy ? moveText({ kind: "slide", dx: dx, dy: dy }) : "");
        render();
      } else if (S.drag && S.drag.type === "turn") {
        var c = toData(d), a = Math.atan2(c[1] - S.center[1], c[0] - S.center[0]) * 180 / Math.PI, diff = a - S.drag.prev;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        S.drag.acc += diff; S.drag.prev = a;
        var delta = Math.round(S.drag.acc / 15) * 15;
        S.turnLive.delta = delta;
        S.T = compose(rotateAbout(delta, S.center), S.drag.T0);
        setStatus(delta ? moveText({ kind: "turn", deg: delta, c: S.center }) : "");
        render();
      } else if (S.down) { S.preview = snapPt(d); render(); }

    });
    function endPointer(e, cancelled) {
      var d = toDraw(e);
      if (S.drag) {
        var dr = S.drag; S.drag = null;
        if (dr.type === "slide") {
          S.T = dr.T0;
          if (!cancelled) slideBy(dr.dx, dr.dy);
        } else {
          var delta = S.turnLive ? S.turnLive.delta : 0;
          S.T = dr.T0; S.turnLive = null;
          if (!cancelled) turnBy(delta);
        }
        render(); return;
      }
      if (!S.down) return;
      S.down = false;
      var p = S.preview || snapPt(d); S.preview = null;
      if (!cancelled) tap(p, d);
      render();
    }
    svg.addEventListener("pointerup", function (e) { endPointer(e, false); });
    svg.addEventListener("pointercancel", function (e) { endPointer(e, true); });
    /* ---- keyboard ---- */
    var viaPointer = false, kbEntered = false;                   // did the grid get focus from the keyboard (Tab) or from a click?
    function setKb(v) { kbEntered = v; svg.classList.toggle("pl-kb", v); }   // the focus ring shows only for keyboard focus, never after a click
    svg.addEventListener("pointerdown", function () { setKb(false); viaPointer = true; setTimeout(function () { viaPointer = false; }, 0); }, true);
    svg.addEventListener("focus", function () { setKb(!viaPointer); });
    svg.addEventListener("blur", function () { setKb(false); });
    svg.addEventListener("keydown", function (e) {
      var k = e.key, st = S.snap;
      if (folding) return;
      if (k === "Escape") { cancelPending(); setStatus(""); setKb(false); render(); return; }
      if (!kbEntered) return;                                     // focused by a click: the keys belong to the host page, not the keyboard cursor
      e.stopPropagation();
      var dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
      if (dir) {
        e.preventDefault();
        if (e.shiftKey && S.paper && S.tool === "slide") { slideBy(dir[0], dir[1]); render(); return; }
        if (!S.kb) S.kb = [snapV(0, S.xr[0], S.xr[1]), snapV(0, S.yr[0], S.yr[1])];
        S.kb = [snapV(S.kb[0] + dir[0] * st, S.xr[0], S.xr[1]), snapV(S.kb[1] + dir[1] * st, S.yr[0], S.yr[1])];
        S.kbOn = true; render(); return;
      }
      if (k === "Enter" || k === " ") {
        e.preventDefault();
        if (!S.kb) S.kb = [snapV(0, S.xr[0], S.xr[1]), snapV(0, S.yr[0], S.yr[1])];
        S.kbOn = true;
        if (PAPER.indexOf(S.tool) >= 0 && !S.paper) return;
        if (S.tool === "slide") return;
        tap(S.kb.slice(), [X(S.kb[0]), Y(S.kb[1]), 1]);
        render();
      }
    });
    svg.addEventListener("blur", function () { S.kbOn = false; kbEntered = false; render(); });

    /* ---- buttons ---- */
    bar.addEventListener("click", onBtn); pbar.addEventListener("click", onBtn); side.addEventListener("click", onBtn);   // the sidebar holds the gear and its menu
    var wide = window.matchMedia ? window.matchMedia("(min-width: 60rem)") : { matches: false };   // wide: the panel is always out (see the CSS); narrow: an overlay
    function dockSteps() {                                       // wide: the Steps card in the left sidebar holds the hint, the moves and the status, and the paper tools are a card above it; narrow: all back under the grid
      if (wide.matches) { left.appendChild(pbar); left.appendChild(movesBox); movesBox.insertBefore(hint, movesEmpty); movesBox.appendChild(status); }
      else { root_.appendChild(pbar); root_.appendChild(hint); root_.appendChild(status); root_.appendChild(movesBox); }
    }
    dockSteps();
    if (wide.addEventListener) wide.addEventListener("change", dockSteps);
    function toggleSettings(open) {
      cfg.hidden = !open; setBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) cin.x0.focus();
    }
    document.addEventListener("click", function (e) {            // narrow: a click anywhere else closes the overlay
      if (!wide.matches && !cfg.hidden && !cfg.contains(e.target) && !setBtn.contains(e.target)) toggleSettings(false);
    });
    root_.addEventListener("keydown", function (e) {              // a host (a slide deck) must not turn Space in a button, or any key typed in a box, into navigation
      var t = e.target, nav = e.key === " " || e.key.indexOf("Arrow") === 0 || e.key === "Home" || e.key === "End" || e.key === "PageUp" || e.key === "PageDown";
      if (nav && t && ((t.tagName === "INPUT") || (t.tagName === "BUTTON" && e.key === " "))) e.stopPropagation();
    });
    cfg.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (wide.matches) return; toggleSettings(false); setBtn.focus(); return; } if (e.key === "Enter" && e.target.closest && e.target.closest("input")) { e.preventDefault(); applyGrid(); render(); } });
    function onBtn(e) {
      var b = e.target.closest && e.target.closest("button[data-key]");
      if (!b || b.disabled || folding) return;
      var k = b.getAttribute("data-key");
      if (DRAW.indexOf(k) >= 0 || (PAPER.indexOf(k) >= 0)) { selectTool(k); return; }
      if (k === "clear") { S.items = []; S.names = {}; S.nameSeq = 0; cancelPending(); setStatus(""); }
      else if (k === "paper") {
        S.paper = !S.paper;
        if (!S.paper && PAPER.indexOf(S.tool) >= 0) S.tool = "line";
        cancelPending(); setStatus(S.paper ? "Blank paper is on the grid. Mark points on it to copy them." : "");
      } else if (k === "undo") { if (hi > 0) { goHist(hi - 1); setStatus("Undid the last step on the paper."); }
      } else if (k === "redo") { if (hi < hist.length - 1) { goHist(hi + 1); setStatus("Redid the step."); }
      } else if (k === "reset") { S.T = I.slice(); S.moves = []; S.center = null; S.hAng = 0; S.flipFrom = null; setStatus("Paper reset."); }
      else if (k === "close") closePolygon();
      else if (k === "settings") toggleSettings(cfg.hidden);
      else if (k === "togrid") markImageOnGrid();
      else if (k === "setgrid") applyGrid();
      else if (k === "resetgrid") {
        S.xr = (preset.xr || [-10, 10]).slice(); S.yr = (preset.yr || [-10, 10]).slice(); S.kb = null; S.kbOn = false; cancelPending();
        cfgMsg.textContent = "Grid reset.";
      }
      else if (k === "clearmarks") { S.outlines = []; S.marks = []; setStatus("Marks cleared from the paper."); }
      else if (k === "cw") turnBy(-15);
      else if (k === "ccw") turnBy(15);
      else if (k === "check") check();
      render();
    }

    render();
    return { host: host };
  }

  /* ---- dialog ---- */
  function openModal(opts) {
    opts = opts || {};
    var prev = document.activeElement;
    var ov = h("div", { class: "pl-overlay" }), dlg = h("div", { class: "pl-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Graphing grid" });
    var close = h("button", { type: "button", class: "pl-btn pl-close" }, "Close");
    var body = h("div", { class: "pl-modalbody" });
    dlg.appendChild(close); dlg.appendChild(body); ov.appendChild(dlg); document.body.appendChild(ov);
    mount(body, { presets: opts.presets, preset: opts.preset, headingLevel: 2 });
    function done() {
      document.removeEventListener("keydown", onKey, true);
      ov.remove();
      if (prev && prev.focus) prev.focus();
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); done(); } }
    document.addEventListener("keydown", onKey, true);
    close.addEventListener("click", done);
    ov.addEventListener("click", function (e) { if (e.target === ov) done(); });
    close.focus();
  }

  root.Plotter = { mount: mount, openModal: openModal, presets: PRESETS };

  /* ---- bookSHelf page-plugin wrapper ---- */
  if (root.BookshelfPlugins) {
    root.BookshelfPlugins.register("plotter", {
      mount: function (_slot, config) {
        config = config || {};
        document.documentElement.classList.add("pl-page-themed");   // follow the page's own light/dark choice, not the OS
        var presets = config.presets && config.presets.length ? config.presets : PRESETS;
        var isOpen = false;
        function open(pid) {
          if (isOpen) return;
          isOpen = true;
          openModal({ presets: presets, preset: pid, onClose: function () { isOpen = false; } });
        }
        var hosts = document.querySelectorAll(".pl-inline");
        for (var i = 0; i < hosts.length; i++) {
          var hs = hosts[i];
          if (hs.getAttribute("data-pl-mounted")) continue;
          hs.setAttribute("data-pl-mounted", "1");
          mount(hs, { presets: presets, headingLevel: 4, preset: hs.getAttribute("data-plotter-preset") || undefined });
        }
        document.addEventListener("click", function (ev) {
          var t = ev.target.closest && ev.target.closest('a[href^="#plotter"], [data-plotter]');
          if (!t) return;
          ev.preventDefault();
          var pid = t.getAttribute("data-plotter-preset");
          if (!pid && t.getAttribute("href")) { var m = t.getAttribute("href").match(/^#plotter(?::(.+))?$/); pid = m && m[1]; }
          open(pid || undefined);
        });
      },
    });
  }
})(typeof self !== "undefined" ? self : this);
