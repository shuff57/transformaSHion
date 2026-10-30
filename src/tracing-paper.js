/*! Tracing Paper: a coordinate-grid tool for slides, turns and flips.
 *
 * Lay a sheet of tracing paper over a grid, mark points on it, then slide it, turn it about a
 * center you pick, or flip it over a mirror line you pick. The tool shows where each marked
 * point is now. It never says what move connects two figures: it only shows where things went.
 *
 * No dependencies. Works as a page (index.html), embedded in any element, or as a modal:
 *   var tp = TracingPaper.mount(el, { presets: [...], preset: "id" });
 *   TracingPaper.openModal({ presets: [...], preset: "id" });
 *
 * Preset: { id, title, note, xr: [x0, x1], yr: [y0, y1],
 *           shapes: [{ name, pts: [[x, y], ...], role: "pre" | "ref", closed: true }],
 *           guides: [{ type: "v", a } | { type: "h", b } | { type: "diag" } | { type: "line", p, q }],
 *           center: [x, y],                      // optional starting center
 *           checks: [{ label, answer: [[x, y], ...] }] }
 *
 * Coordinates: world (x right, y up). The paper has its own (u, v); a 2x3 matrix M maps paper to
 * world, x = a u + c v + e, y = b u + d v + f. Marks are stored in paper coordinates, so they
 * move with the paper.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TracingPaper = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ------------------------------------------------------------------ matrix math
  var ID = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  function mul(A, B) {            // A after B
    return {
      a: A.a * B.a + A.c * B.b, b: A.b * B.a + A.d * B.b,
      c: A.a * B.c + A.c * B.d, d: A.b * B.c + A.d * B.d,
      e: A.a * B.e + A.c * B.f + A.e, f: A.b * B.e + A.d * B.f + A.f,
    };
  }
  function apply(M, p) { return [M.a * p[0] + M.c * p[1] + M.e, M.b * p[0] + M.d * p[1] + M.f]; }
  function det(M) { return M.a * M.d - M.b * M.c; }
  function inv(M) {
    var D = det(M);
    return { a: M.d / D, b: -M.b / D, c: -M.c / D, d: M.a / D, e: (M.c * M.f - M.d * M.e) / D, f: (M.b * M.e - M.a * M.f) / D };
  }
  function clean(M) {
    var o = {};
    for (var k in M) o[k] = Math.round(M[k] * 1e9) / 1e9 + 0;
    return o;
  }
  function translation(dx, dy) { return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy }; }
  function cosSin(deg) {
    var r = ((deg % 360) + 360) % 360;
    if (r === 0) return [1, 0];
    if (r === 90) return [0, 1];
    if (r === 180) return [-1, 0];
    if (r === 270) return [0, -1];
    var t = deg * Math.PI / 180;
    return [Math.cos(t), Math.sin(t)];
  }
  function rotation(c, deg) {     // counterclockwise about world point c
    var cs = cosSin(deg), co = cs[0], si = cs[1];
    return { a: co, b: si, c: -si, d: co, e: c[0] - co * c[0] + si * c[1], f: c[1] - si * c[0] - co * c[1] };
  }
  function unitNormal(line) {
    var dx = line.d[0], dy = line.d[1], L = Math.sqrt(dx * dx + dy * dy);
    return [-dy / L, dx / L];
  }
  function reflection(line, k) {  // k = 2 is the full flip; smaller k is a partly folded paper
    k = k == null ? 2 : k;
    var n = unitNormal(line), nq = n[0] * line.q[0] + n[1] * line.q[1];
    return { a: 1 - k * n[0] * n[0], b: -k * n[0] * n[1], c: -k * n[0] * n[1], d: 1 - k * n[1] * n[1], e: k * nq * n[0], f: k * nq * n[1] };
  }

  // ------------------------------------------------------------------ text helpers
  function num(x) {
    var r = Math.round(x * 100) / 100;
    if (r === 0) r = 0;
    return String(r).replace("-", "−");
  }
  function pt(p) { return "(" + num(p[0]) + ", " + num(p[1]) + ")"; }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a || 1; }
  function frac(n, d) {
    var g = gcd(n, d); n /= g; d /= g;
    if (d < 0) { n = -n; d = -d; }
    return d === 1 ? num(n) : num(n) + "/" + d;
  }
  function slideText(dx, dy) {
    var parts = [];
    if (dx) parts.push((dx > 0 ? "right " : "left ") + num(Math.abs(dx)));
    if (dy) parts.push((dy > 0 ? "up " : "down ") + num(Math.abs(dy)));
    return "slide " + (parts.join(", ") || "0");
  }
  function lineText(L) {
    var dx = L.d[0], dy = L.d[1];
    if (dx === 0) return "x = " + num(L.q[0]);
    if (dy === 0) return "y = " + num(L.q[1]);
    var allInt = [dx, dy, L.q[0], L.q[1]].every(function (v) { return Math.abs(v - Math.round(v)) < 1e-9; });
    if (!allInt) return "the line through " + pt(L.q) + " with direction " + pt(L.d);
    var m = frac(dy, dx);
    var k = L.q[1] - (dy / dx) * L.q[0];
    var kn = frac(Math.round(k * dx), dx);
    var mTxt = m === "1" ? "" : (m === "-1" || m === "−1" ? "−" : m);
    if (m.indexOf("/") > -1) mTxt = "(" + m + ")";
    var base = "y = " + (mTxt ? mTxt + "x" : "x");
    if (k === 0) return base;
    return base + (k > 0 ? " + " + kn : " − " + kn.replace("−", ""));
  }
  function lineFrom(def) {
    if (def.type === "v") return { q: [def.a, 0], d: [0, 1] };
    if (def.type === "h") return { q: [0, def.b], d: [1, 0] };
    if (def.type === "diag") return { q: [0, 0], d: [1, 1] };
    return { q: def.p.slice(), d: [def.q[0] - def.p[0], def.q[1] - def.p[1]] };
  }
  function parsePoints(s) {
    var re = /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g, out = [], m;
    s = String(s).replace(/−/g, "-");
    while ((m = re.exec(s))) out.push([parseFloat(m[1]), parseFloat(m[2])]);
    return out;
  }
  function samePointSet(A, B) {
    if (A.length !== B.length) return false;
    var used = B.map(function () { return false; });
    return A.every(function (p) {
      for (var i = 0; i < B.length; i++) {
        if (!used[i] && Math.abs(p[0] - B[i][0]) < 1e-6 && Math.abs(p[1] - B[i][1]) < 1e-6) { used[i] = true; return true; }
      }
      return false;
    });
  }

  // ------------------------------------------------------------------ geometry on screen
  var ML = 40, MT = 20, MB = 34, MR = 26;
  var uid = 0;

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (attrs[k] === true) n.setAttribute(k, "");
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  var BLANK = { id: "blank", title: "Blank grid", xr: [-10, 10], yr: [-8, 8], shapes: [], guides: [], checks: [] };

  function normalize(p) {
    var q = {};
    for (var k in BLANK) q[k] = p[k] != null ? p[k] : BLANK[k];
    q.note = p.note || ""; q.center = p.center || null;
    q.xr = q.xr.slice(); q.yr = q.yr.slice();
    return q;
  }

  // ------------------------------------------------------------------ the tool
  function mount(host, opts) {
    opts = opts || {};
    var presets = (opts.presets && opts.presets.length ? opts.presets : [BLANK]).map(normalize);
    var id = "tp" + (++uid);
    var CELL = 30;                  // pixels per grid square in the drawing; shrinks for wide grids so the text stays readable
    var reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    var S = {
      pi: 0, P: null, paper: false, M: ID, traces: [], closed: false, mode: "plotshape", fig: [], figClosed: false, plotMode: "free", snap: true,
      center: null, mirror: null, pend: [], pred: [], predOk: false, history: [], log: [], drag: null, busy: false, ghost: null,
    };

    var ui = {};
    host.classList.add("tp-root");
    host.innerHTML = "";
    var wrap = el("div", { class: "tp" });
    host.appendChild(wrap);

    // ---- build the static UI once
    var head = el("div", { class: "tp-head" });
    var pin = el("div", { class: "tp-pin" });
    ui.title = el("h" + (opts.headingLevel || 2), { class: "tp-title" });
    ui.note = el("p", { class: "tp-note" });
    ui.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ui.svg.setAttribute("class", "tp-svg");
    ui.svg.setAttribute("tabindex", "0");
    ui.svg.setAttribute("role", "application");
    ui.svg.setAttribute("aria-label", "Coordinate grid with tracing paper. Use the controls beside it, or the arrow keys to slide the paper one unit.");
    ui.live = el("div", { class: "tp-live", role: "status", "aria-live": "polite" });
    head.appendChild(ui.title); head.appendChild(ui.note); pin.appendChild(ui.svg); pin.appendChild(ui.live);

    var side = el("div", { class: "tp-side" });
    var tabs = el("div", { class: "tp-tabs", role: "tablist", "aria-label": "Tracing paper controls" });
    var panels = {}, tabOrder = [];
    function panel(key, label) {
      var b = el("button", { type: "button", class: "tp-tab", role: "tab", id: id + "-t-" + key, "aria-controls": id + "-p-" + key, text: label });
      var p = el("div", { class: "tp-panel", role: "tabpanel", id: id + "-p-" + key, "aria-labelledby": id + "-t-" + key });
      b.addEventListener("click", function () { showTab(key); });
      b.addEventListener("keydown", function (e) {
        var vis = tabOrder.filter(function (k) { return !panels[k].b.hidden; }), i = vis.indexOf(key), n = -1;
        if (e.key === "ArrowRight") n = (i + 1) % vis.length; else if (e.key === "ArrowLeft") n = (i - 1 + vis.length) % vis.length;
        else if (e.key === "Home") n = 0; else if (e.key === "End") n = vis.length - 1;
        if (n >= 0) { e.preventDefault(); showTab(vis[n]); panels[vis[n]].b.focus(); }
      });
      tabs.appendChild(b); panels[key] = { b: b, p: p }; tabOrder.push(key);
      return p;
    }
    function showTab(key) {
      tabOrder.forEach(function (k) {
        var on = k === key;
        panels[k].p.hidden = !on; panels[k].b.setAttribute("aria-selected", on ? "true" : "false"); panels[k].b.tabIndex = on ? 0 : -1;
      });
    }
    var pPaper = panel("paper", "Paper"), pSlide = panel("slide", "Slide"), pTurn = panel("turn", "Turn"), pFlip = panel("flip", "Flip"), pCheck = panel("check", "Check");
    side.appendChild(tabs);
    [pPaper, pSlide, pTurn, pFlip, pCheck].forEach(function (p) { side.appendChild(p); });
    function group(title, kids, into) {
      var g = el("section", { class: "tp-group" }, title ? [el("h" + (opts.headingLevel ? opts.headingLevel + 1 : 3), { text: title })] : []);
      kids.forEach(function (k) { g.appendChild(k); });
      (into || side).appendChild(g);
      return g;
    }
    function btn(text, fn, cls) {
      var b = el("button", { type: "button", class: "tp-btn" + (cls ? " " + cls : ""), text: text });
      b.addEventListener("click", fn);
      return b;
    }
    function numInput(label, val, w) {
      var i = el("input", { type: "number", value: String(val), step: "1", class: "tp-num", "aria-label": label });
      if (w) i.style.width = w;
      return i;
    }
    function row(kids) { return el("div", { class: "tp-row" }, kids); }
    function lab(text) { return el("span", { class: "tp-lab", text: text }); }

    if (presets.length > 1) {
      ui.sel = el("select", { class: "tp-sel", "aria-label": "Choose a setup" });
      presets.forEach(function (p, i) { ui.sel.appendChild(el("option", { value: String(i), text: p.title })); });
      ui.sel.addEventListener("change", function () { setPreset(+ui.sel.value); });
      side.insertBefore(group("Setup", [ui.sel]), tabs);
    }

    ui.lay = btn("Lay tracing paper on the grid", function () { layPaper(!S.paper); });
    ui.trace = btn("Trace my shape", traceFigure);
    ui.closeShape = btn("Join my marks", function () { S.closed = true; draw(); });
    ui.clear = btn("Clear marks", function () { S.traces = []; S.closed = false; draw(); say("Marks cleared."); });
    ui.modes = el("div", { class: "tp-modes", role: "radiogroup", "aria-label": "What a click on the grid does" });
    ui.radios = {};
    [["plotshape", "Plot the shape"], ["move", "Drag the paper"], ["mark", "Mark points"], ["center", "Pick a center"], ["mirror", "Pick a mirror (two points)"], ["predict", "Plot a prediction"]].forEach(function (m) {
      var l = el("label", { class: "tp-mode" });
      var r = el("input", { type: "radio", name: id + "-mode", value: m[0] });
      if (m[0] === "plotshape") r.checked = true;
      r.addEventListener("change", function () { S.mode = m[0]; S.pend = []; if (m[0] === "predict") showTab("check"); draw(); });
      ui.radios[m[0]] = r;
      if (m[0] === "predict") ui.predLabel = l;
      l.appendChild(r); l.appendChild(el("span", { text: m[1] }));
      ui.modes.appendChild(l);
    });
    ui.snapBox = el("input", { type: "checkbox", checked: true });
    ui.snapBox.addEventListener("change", function () { S.snap = ui.snapBox.checked; });
    ui.shapeHint = el("p", { class: "tp-hint" });
    ui.shapeIn = el("input", { type: "text", class: "tp-text", placeholder: "(x, y), (x, y), ...", "aria-label": "Your shape's corner points" });
    ui.shapeMsg = el("p", { class: "tp-shapemsg", role: "status", "aria-live": "polite" });
    ui.shapeIn.addEventListener("input", function () { S.fig = parsePoints(ui.shapeIn.value); ui.shapeMsg.textContent = ""; draw(); });
    ui.shapeCheck = btn("Check my shape", doCheckShape);
    group("The shape", [ui.shapeHint,
      row([btn("Plot on the grid", function () { ui.radios.plotshape.checked = true; S.mode = "plotshape"; S.pend = []; draw(); say("Click the grid to plot each corner. Click a plotted corner again to remove it."); }),
        btn("Close the shape", function () { S.figClosed = S.fig.length > 2; draw(); say(S.figClosed ? "Shape closed." : "Plot at least three corners first."); }),
        btn("Clear the shape", function () { S.fig = []; S.figClosed = false; ui.shapeIn.value = ""; ui.shapeMsg.textContent = ""; draw(); say("Shape cleared."); })]),
      ui.shapeIn, row([ui.shapeCheck]), ui.shapeMsg], pPaper);
    group("The paper", [row([ui.lay]), row([ui.trace, ui.closeShape, ui.clear]), ui.modes,
      el("label", { class: "tp-snap" }, [ui.snapBox, el("span", { text: "Snap clicks to grid points" })])], pPaper);

    ui.dx = numInput("slide right by", 4, "4.2em"); ui.dy = numInput("slide up by", 0, "4.2em");
    group(null, [row([lab("right"), ui.dx, lab("up"), ui.dy, btn("Slide", function () {
      doSlide(+ui.dx.value || 0, +ui.dy.value || 0);
    })]), el("p", { class: "tp-hint", text: "You can also drag the paper, or press an arrow key on the grid." })], pSlide);

    ui.centerTxt = el("span", { class: "tp-val", text: "no center yet" });
    ui.ang = numInput("angle in degrees", 90, "4.4em");
    ui.cx = numInput("center x", 0, "3.6em"); ui.cy = numInput("center y", 0, "3.6em");
    group(null, [
      row([lab("center"), ui.centerTxt]),
      row([lab("or type"), lab("("), ui.cx, lab(","), ui.cy, lab(")"), btn("Set", function () {
        S.center = [+ui.cx.value || 0, +ui.cy.value || 0]; draw();
      })]),
      row([lab("angle"), ui.ang, lab("°")]),
      row([btn("↺ counterclockwise", function () { doTurn(+ui.ang.value || 0); }),
        btn("↻ clockwise", function () { doTurn(-(+ui.ang.value || 0)); })]),
    ], pTurn);

    ui.mirrorTxt = el("span", { class: "tp-val", text: "no mirror yet" });
    ui.vx = numInput("mirror x equals", 5, "3.6em"); ui.hy = numInput("mirror y equals", 0, "3.6em");
    ui.quick = row([]);
    group(null, [
      row([lab("mirror"), ui.mirrorTxt]),
      ui.quick,
      row([btn("x-axis", function () { setMirror({ type: "h", b: 0 }); }), btn("y-axis", function () { setMirror({ type: "v", a: 0 }); }),
        btn("y = x", function () { setMirror({ type: "diag" }); })]),
      row([lab("x ="), ui.vx, btn("Set", function () { setMirror({ type: "v", a: +ui.vx.value || 0 }); }),
        lab("y ="), ui.hy, btn("Set", function () { setMirror({ type: "h", b: +ui.hy.value || 0 }); })]),
      row([btn("Flip the paper over the mirror", doFlip, "tp-primary")]),
    ], pFlip);

    ui.table = el("div", { class: "tp-table" });
    ui.moves = el("ol", { class: "tp-moves" });
    ui.undo = btn("Undo last move", undo);
    ui.reset = btn("Put the paper back", resetPaper);
    var under = el("div", { class: "tp-under" });
    group("Where the marks are", [ui.table], under);
    group("Moves so far", [ui.moves, row([ui.undo, ui.reset])], under);

    ui.checkBox = el("section", { class: "tp-group tp-check" });
    ui.checkSel = el("select", { class: "tp-sel", "aria-label": "Which move are you predicting" });
    ui.checkIn = el("input", { type: "text", class: "tp-text", placeholder: "(0, 0), (3, 1), (2, 4)", "aria-label": "Your predicted image points" });
    ui.checkMsg = el("p", { class: "tp-checkmsg", role: "status", "aria-live": "polite" });
    ui.checkBox.appendChild(el("h" + (opts.headingLevel ? opts.headingLevel + 1 : 3), { text: "Check a prediction" }));
    ui.checkBox.appendChild(el("p", { class: "tp-hint", text: "Predict first, then test it with the paper. Plot one point for each corner of the figure on the grid, or type them." }));
    ui.checkBox.appendChild(ui.checkSel);
    ui.checkBox.appendChild(ui.checkIn);
    ui.checkBox.appendChild(row([btn("Plot on the grid", function () { ui.radios.predict.checked = true; S.mode = "predict"; S.pend = []; draw(); say("Click the grid to plot each predicted point. Click a plotted point again to remove it."); }),
      btn("Clear my points", function () { S.pred = []; S.predOk = false; ui.checkIn.value = ""; ui.checkMsg.textContent = ""; draw(); })]));
    ui.checkBox.appendChild(row([btn("Check", doCheck)]));
    ui.checkIn.addEventListener("input", function () { S.pred = parsePoints(ui.checkIn.value); S.predOk = false; ui.checkMsg.textContent = ""; draw(); });
    ui.checkBox.appendChild(ui.checkMsg);
    pCheck.appendChild(ui.checkBox);

    var left = el("div", { class: "tp-left" });
    var stick = el("div", { class: "tp-stick" });
    stick.appendChild(pin); stick.appendChild(under);
    left.appendChild(head); left.appendChild(stick);
    wrap.appendChild(left); wrap.appendChild(side);

    // keep the grid pinned just under the page's own sticky header, if it has one
    function pinTop() {
      var m = 0;
      if (!host.closest(".tp-dialog")) {
        var c = document.querySelectorAll("header, nav, [class*=navbar], [class*=topbar], [class*=site-header]");
        for (var i = 0; i < c.length; i++) {
          var cs = getComputedStyle(c[i]);
          if (cs.position !== "fixed" && cs.position !== "sticky") continue;
          var r = c[i].getBoundingClientRect();
          if (r.top <= 1 && r.bottom > m && r.bottom < 260) m = r.bottom;
        }
      }
      wrap.style.setProperty("--tp-top", (m + 8) + "px");
    }
    pinTop();
    window.addEventListener("resize", pinTop);

    // ---- announcements
    function say(t) { ui.live.textContent = t; }

    // ---- setup and state changes
    function setPreset(i) {
      S.pi = i; S.P = presets[i];
      CELL = Math.max(16, Math.min(30, Math.floor(760 / (S.P.xr[1] - S.P.xr[0]))));
      S.paper = false; S.M = ID; S.traces = []; S.closed = false; S.history = []; S.log = [];
      S.center = S.P.center ? S.P.center.slice() : null; S.mirror = null; S.pend = [];
      S.drag = null; S.ghost = null;
      S.fig = []; S.figClosed = false; S.mode = "plotshape"; S.pred = []; S.predOk = false;
      if (ui.radios && ui.radios.plotshape) ui.radios.plotshape.checked = true;
      var target = targetPoints();
      S.plotMode = S.P.plot || (target.length ? "given" : "free");
      ui.shapeIn.value = ""; ui.shapeMsg.textContent = "";
      ui.shapeCheck.style.display = S.plotMode === "given" ? "" : "none";
      ui.shapeHint.textContent = S.plotMode === "given"
        ? "Plot the " + S.P.shapes.filter(function (s) { return s.role !== "ref"; }).map(function (s) { return s.name || "shape"; }).join(" and ") + ": " + target.map(pt).join(", ") + ". Click the grid for each corner in this order, then close the shape (use the Close the shape button, or click corner A again)."
        : "Plot a shape of your own: click the grid for each corner, then close the shape.";
      if (ui.sel) ui.sel.value = String(i);
      ui.title.textContent = S.P.title;
      ui.note.textContent = S.P.note;
      ui.note.style.display = S.P.note ? "" : "none";
      ui.quick.innerHTML = "";
      (S.P.guides || []).forEach(function (g) {
        var L = lineFrom(g);
        ui.quick.appendChild(btn("Use " + lineText(L), function () { setMirror(g); }));
      });
      ui.quick.style.display = (S.P.guides || []).length ? "" : "none";
      ui.checkSel.innerHTML = "";
      (S.P.checks || []).forEach(function (c, k) { ui.checkSel.appendChild(el("option", { value: String(k), text: c.label })); });
      var hasChecks = (S.P.checks || []).length > 0 && S.plotMode === "given";
      panels.check.b.hidden = !hasChecks;
      if (!hasChecks && !panels.check.p.hidden) showTab("paper");
      ui.checkMsg.textContent = ""; ui.checkIn.value = ""; S.pred = []; S.predOk = false;
      ui.predLabel.style.display = hasChecks ? "" : "none";
      if (!hasChecks && S.mode === "predict") { S.mode = "move"; ui.radios.move.checked = true; }
      ui.svg.setAttribute("viewBox", "0 0 " + (ML + (S.P.xr[1] - S.P.xr[0]) * CELL + MR) + " " + (MT + (S.P.yr[1] - S.P.yr[0]) * CELL + MB));
      draw();
      say("Setup: " + S.P.title + ".");
    }
    function layPaper(on) {
      S.paper = on; S.M = ID; S.history = []; S.log = []; if (!on) { S.traces = []; S.closed = false; }
      draw(); say(on ? "Tracing paper is on the grid." : "Paper picked up. Marks cleared.");
    }
    function targetPoints() {
      var pts = [];
      (S.P.shapes || []).filter(function (s) { return s.role !== "ref"; }).forEach(function (s) { s.pts.forEach(function (q) { pts.push(q); }); });
      return pts;
    }
    function doCheckShape() {
      var want = targetPoints();
      if (!S.fig.length) { ui.shapeMsg.textContent = "Plot the corners on the grid, or type them."; return; }
      if (S.fig.length !== want.length) { ui.shapeMsg.textContent = "Plot one point for each corner (" + want.length + " points)."; return; }
      ui.shapeMsg.textContent = samePointSet(S.fig, want) ? "Matches. Now try the paper." : "Does not match yet. Check each corner against the list.";
    }
    function traceFigure() {
      if (!S.fig.length) { say("Plot the shape on the grid first."); return; }
      if (!S.paper) layPaper(true);
      var inv_ = inv(S.M), pts = S.fig.slice();
      S.traces = pts.map(function (p) { return { uv: apply(inv_, p), at: p.slice() }; });
      S.closed = S.figClosed && pts.length > 2;
      draw(); say("Traced " + pts.length + " points: " + S.traces.map(function (t, i) { return "P" + (i + 1) + " " + pt(t.at); }).join(", ") + ".");
    }
    function setMirror(def) {
      S.mirror = lineFrom(def); S.pend = []; draw(); say("Mirror: " + lineText(S.mirror) + ".");
    }

    // ---- moves
    function snapshot() { S.history.push({ M: S.M, n: S.log.length }); }
    function finish(M, text) {
      S.M = clean(M); S.log.push(text); S.busy = false; S.ghost = null; draw();
      say(text.charAt(0).toUpperCase() + text.slice(1) + "." + (S.traces.length ? " " + S.traces.map(function (t, i) { return "P" + (i + 1) + " is at " + pt(apply(S.M, t.uv)); }).join(", ") + "." : ""));
    }
    function animate(frame, final, text) {
      if (!S.paper) { say("Lay the tracing paper on the grid first."); return; }
      if (S.busy) return;
      snapshot();
      if (reduce) { finish(final, text); return; }
      S.busy = true;
      var t0 = null, MS = 450;
      (function step(ts) {
        if (t0 == null) t0 = ts;
        var t = Math.min(1, (ts - t0) / MS), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        if (t < 1) { S.ghost = frame(e); draw(); requestAnimationFrame(step); } else finish(final, text);
      })(performance.now());
    }
    function doSlide(dx, dy) {
      if (!dx && !dy) { say("Nothing to slide. Choose how far to slide."); return; }
      animate(function (t) { return mul(translation(dx * t, dy * t), S.M); }, mul(translation(dx, dy), S.M), slideText(dx, dy));
    }
    function doTurn(deg) {
      if (!S.paper) { say("Lay the tracing paper on the grid first."); return; }
      if (!S.center) { say("Pick a center first."); return; }
      if (!deg) { say("Choose an angle to turn."); return; }
      var c = S.center.slice();
      var text = "turn " + num(Math.abs(deg)) + "° " + (deg > 0 ? "counterclockwise" : "clockwise") + " about " + pt(c);
      animate(function (t) { return mul(rotation(c, deg * t), S.M); }, mul(rotation(c, deg), S.M), text);
    }
    function doFlip() {
      if (!S.paper) { say("Lay the tracing paper on the grid first."); return; }
      if (!S.mirror) { say("Pick a mirror first."); return; }
      var L = S.mirror;
      animate(function (t) { return mul(reflection(L, 2 * t), S.M); }, mul(reflection(L, 2), S.M), "flip over " + lineText(L));
    }
    function undo() {
      if (S.busy || !S.history.length) return;
      var h = S.history.pop(); S.M = h.M; S.log.length = h.n; draw(); say("Undid the last move.");
    }
    function resetPaper() {
      if (S.busy) return;
      S.M = ID; S.history = []; S.log = []; draw(); say("Paper put back where you laid it.");
    }

    // ---- checking a prediction
    function doCheck() {
      var c = S.P.checks[+ui.checkSel.value || 0];
      var got = parsePoints(ui.checkIn.value);
      if (!got.length) { ui.checkMsg.textContent = "Plot your points on the grid, or type them like (9, 2), (6, 2), (9, 6)."; return; }
      if (got.length !== c.answer.length) { ui.checkMsg.textContent = "Plot one point for each corner of the figure (" + c.answer.length + " points)."; return; }
      S.predOk = samePointSet(got, c.answer); draw();
      ui.checkMsg.textContent = S.predOk
        ? "Matches. Test it with the paper to see why."
        : "Does not match yet. Fold or move the paper to test your prediction.";
    }

    // ---- drawing
    function px(x) { return ML + (x - S.P.xr[0]) * CELL; }
    function py(y) { return MT + (S.P.yr[1] - y) * CELL; }
    function P2(p) { return px(p[0]).toFixed(1) + "," + py(p[1]).toFixed(1); }
    function polyPts(pts) { return pts.map(P2).join(" "); }

    function drawLineClipped(L, cls) {
      var a = [L.q[0] - 400 * L.d[0], L.q[1] - 400 * L.d[1]], b = [L.q[0] + 400 * L.d[0], L.q[1] + 400 * L.d[1]];
      return '<line class="' + cls + '" clip-path="url(#' + id + 'clip)" x1="' + px(a[0]).toFixed(1) + '" y1="' + py(a[1]).toFixed(1) +
        '" x2="' + px(b[0]).toFixed(1) + '" y2="' + py(b[1]).toFixed(1) + '"/>';
    }

    function draw() {
      var P = S.P, x0 = P.xr[0], x1 = P.xr[1], y0 = P.yr[0], y1 = P.yr[1], o = [];
      var M = S.drag ? S.drag.M : (S.ghost || S.M);
      o.push('<defs><clipPath id="' + id + 'clip"><rect x="' + px(x0) + '" y="' + py(y1) + '" width="' + (x1 - x0) * CELL + '" height="' + (y1 - y0) * CELL + '"/></clipPath>' +
        '<pattern id="' + id + 'back" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" class="tp-hatch"/></pattern></defs>');
      var x, y;
      for (x = x0; x <= x1; x++) o.push('<line class="tp-grid" x1="' + px(x) + '" y1="' + py(y0) + '" x2="' + px(x) + '" y2="' + py(y1) + '"/>');
      for (y = y0; y <= y1; y++) o.push('<line class="tp-grid" x1="' + px(x0) + '" y1="' + py(y) + '" x2="' + px(x1) + '" y2="' + py(y) + '"/>');
      var inX = x0 < 0 && x1 > 0, inY = y0 < 0 && y1 > 0, ax = inX ? px(0) : px(x0), ay = inY ? py(0) : py(y0);
      o.push('<line class="tp-axis" x1="' + px(x0) + '" y1="' + ay + '" x2="' + px(x1) + '" y2="' + ay + '"/>');
      o.push('<line class="tp-axis" x1="' + ax + '" y1="' + py(y0) + '" x2="' + ax + '" y2="' + py(y1) + '"/>');
      for (x = x0; x <= x1; x++) if (!(x === 0 && inX && inY)) o.push('<text class="tp-tick" x="' + px(x) + '" y="' + (ay + 16) + '">' + num(x) + "</text>");
      for (y = y0; y <= y1; y++) if (!(y === 0 && (inY || (x0 === 0 && y0 === 0)))) o.push('<text class="tp-tick tp-end" x="' + (ax - 8) + '" y="' + (py(y) + 4) + '">' + num(y) + "</text>");
      if (inX && inY) o.push('<text class="tp-tick tp-end" x="' + (ax - 8) + '" y="' + (ay + 14) + '">0</text>');
      o.push('<text class="tp-axl" x="' + (px(x1) + 8) + '" y="' + (ay + 5) + '">x</text><text class="tp-axl" x="' + (ax + 7) + '" y="' + (py(y1) - 7) + '">y</text>');

      (P.guides || []).forEach(function (g) {
        var L = lineFrom(g);
        o.push(drawLineClipped(L, "tp-guide"));
      });
      P.shapes.forEach(function (s) {
        if (s.role !== "ref") return;             // the figure to move is the one the student plots
        o.push('<' + (s.closed === false ? "polyline" : "polygon") + ' class="tp-ref" points="' + polyPts(s.pts) + '"/>');
      });
      if (S.fig.length) {
        var closed = S.figClosed && S.fig.length > 2;
        o.push('<' + (closed ? "polygon" : "polyline") + ' class="tp-pre" points="' + polyPts(S.fig) + '"/>');
        S.fig.forEach(function (q, k) {
          o.push('<circle class="tp-fv" cx="' + px(q[0]) + '" cy="' + py(q[1]) + '" r="5"/>');
          o.push('<text class="tp-clbl" x="' + (px(q[0]) + 9) + '" y="' + (py(q[1]) - 8) + '">' + String.fromCharCode(65 + (k % 26)) + '</text>');
        });
      }

      if (S.paper) {
        var corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(function (c) { return apply(M, c); });
        var back = det(M) < 0;
        o.push('<g clip-path="url(#' + id + 'clip)"><polygon class="tp-paper' + (back ? " tp-back" : "") + '" points="' + polyPts(corners) + '"/>');
        if (back) o.push('<polygon fill="url(#' + id + 'back)" opacity="0.5" points="' + polyPts(corners) + '"/>');
        var fold = [apply(M, [x0, y1]), apply(M, [x0 + 1.6, y1]), apply(M, [x0, y1 - 1.6])];
        o.push('<polygon class="tp-fold" points="' + polyPts(fold) + '"/></g>');
      }

      var wp = S.traces.map(function (t) { return apply(M, t.uv); });
      if (wp.length) {
        if (wp.length > 1) o.push('<' + (S.closed ? "polygon" : "polyline") + ' class="tp-mark" points="' + polyPts(wp) + '"/>');
        wp.forEach(function (p, i) {
          o.push('<circle class="tp-dot" cx="' + px(p[0]).toFixed(1) + '" cy="' + py(p[1]).toFixed(1) + '" r="5"/>');
          o.push('<text class="tp-plbl" x="' + (px(p[0]) + 9).toFixed(1) + '" y="' + (py(p[1]) - 9).toFixed(1) + '">P' + (i + 1) + "</text>");
        });
      }
      if (S.mirror) o.push(drawLineClipped(S.mirror, "tp-mirror"));
      S.pend.forEach(function (p) { o.push('<circle class="tp-pend" cx="' + px(p[0]) + '" cy="' + py(p[1]) + '" r="6"/>'); });
      if (S.center) {
        o.push('<circle class="tp-center" cx="' + px(S.center[0]) + '" cy="' + py(S.center[1]) + '" r="8"/>');
        o.push('<text class="tp-clbl" style="text-anchor:end" x="' + (px(S.center[0]) - 12) + '" y="' + (py(S.center[1]) - 10) + '">center</text>');
      }
      S.pred.forEach(function (q, k) {
        o.push('<circle class="tp-pred' + (S.predOk ? " tp-pred-ok" : "") + '" cx="' + px(q[0]) + '" cy="' + py(q[1]) + '" r="7"/>');
        o.push('<text class="tp-clbl" x="' + (px(q[0]) + 11) + '" y="' + (py(q[1]) - 9) + '">Q' + (k + 1) + '</text>');
      });
      ui.svg.innerHTML = o.join("");
      refresh();
    }

    function refresh() {
      ui.lay.textContent = S.paper ? "Pick up the paper (clears marks)" : "Lay tracing paper on the grid";
      ui.centerTxt.textContent = S.center ? pt(S.center) : "no center yet (choose “Pick a center”, then click the grid)";
      ui.mirrorTxt.textContent = S.mirror ? lineText(S.mirror) : "no mirror yet";
      var live = S.paper && !S.busy;
      [ui.trace, ui.undo, ui.reset].forEach(function (b) { b.disabled = !S.paper || S.busy; });
      ui.closeShape.disabled = S.traces.length < 3 || S.closed;
      ui.clear.disabled = !S.traces.length;
      ui.undo.disabled = !live || !S.history.length;
      // the table
      if (!S.traces.length) ui.table.innerHTML = '<p class="tp-hint">No marks yet. Lay the paper down, then trace the figure or mark points.</p>';
      else {
        var h = '<table><thead><tr><th scope="col">Mark</th><th scope="col">Marked at</th><th scope="col">Now at</th><th scope="col">Moved</th></tr></thead><tbody>';
        S.traces.forEach(function (t, i) {
          var now = apply(S.M, t.uv);
          h += "<tr><th scope=\"row\">P" + (i + 1) + "</th><td>" + pt(t.at) + "</td><td>" + pt(now) + "</td><td>" + slideText(now[0] - t.at[0], now[1] - t.at[1]).replace("slide ", "") + "</td></tr>";
        });
        ui.table.innerHTML = h + "</tbody></table>";
      }
      ui.moves.innerHTML = S.log.length ? S.log.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") : '<li class="tp-none">none yet</li>';
      ui.moves.start = 1;
    }

    // ---- pointer and keyboard
    function toWorld(ev) {
      var r = ui.svg.getBoundingClientRect(), vb = ui.svg.viewBox.baseVal;
      var vx = (ev.clientX - r.left) * vb.width / r.width, vy = (ev.clientY - r.top) * vb.height / r.height;
      return [S.P.xr[0] + (vx - ML) / CELL, S.P.yr[1] - (vy - MT) / CELL];
    }
    function snapPt(p) { return S.snap ? [Math.round(p[0]), Math.round(p[1])] : [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]; }
    function inPlane(p) { return p[0] >= S.P.xr[0] - 0.5 && p[0] <= S.P.xr[1] + 0.5 && p[1] >= S.P.yr[0] - 0.5 && p[1] <= S.P.yr[1] + 0.5; }

    ui.svg.addEventListener("pointerdown", function (ev) {
      if (S.busy) return;
      var w = toWorld(ev); if (!inPlane(w)) return;
      var p = snapPt(w);
      if (S.mode === "move") {
        if (!S.paper) { say("Lay the tracing paper on the grid first."); return; }
        S.drag = { start: w, M0: S.M, M: S.M, dx: 0, dy: 0 };
        ui.svg.setPointerCapture(ev.pointerId);
      } else if (S.mode === "mark") {
        if (!S.paper) { say("Lay the tracing paper on the grid first."); return; }
        S.traces.push({ uv: apply(inv(S.M), p), at: p }); draw(); say("Marked P" + S.traces.length + " at " + pt(p) + ".");
      } else if (S.mode === "plotshape") {
        var fh = -1;
        S.fig.forEach(function (q, k) { if (Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) fh = k; });
        if (fh === 0 && S.fig.length > 2) { S.figClosed = !S.figClosed; say(S.figClosed ? "Shape closed." : "Shape opened again."); }
        else if (fh >= 0) { S.fig.splice(fh, 1); if (S.fig.length < 3) S.figClosed = false; say("Removed the corner at " + pt(p) + "."); }
        else { S.fig.push(p); say("Plotted corner " + String.fromCharCode(64 + ((S.fig.length - 1) % 26) + 1) + " at " + pt(p) + "."); }
        ui.shapeMsg.textContent = ""; ui.shapeIn.value = S.fig.map(pt).join(", ");
        draw();
      } else if (S.mode === "predict") {
        if (!(S.P.checks || []).length) return;
        var hit = -1;
        S.pred.forEach(function (q, k) { if (Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) hit = k; });
        if (hit >= 0) { S.pred.splice(hit, 1); say("Removed the point at " + pt(p) + "."); }
        else { S.pred.push(p); say("Plotted Q" + S.pred.length + " at " + pt(p) + "."); }
        S.predOk = false; ui.checkMsg.textContent = "";
        ui.checkIn.value = S.pred.map(pt).join(", ");
        draw();
      } else if (S.mode === "center") {
        S.center = p; showTab("turn"); draw(); say("Center: " + pt(p) + ".");
      } else if (S.mode === "mirror") {
        if (S.pend.length && S.pend[0][0] === p[0] && S.pend[0][1] === p[1]) return;
        S.pend.push(p);
        if (S.pend.length === 2) { S.mirror = lineFrom({ type: "line", p: S.pend[0], q: S.pend[1] }); S.pend = []; showTab("flip"); say("Mirror: " + lineText(S.mirror) + "."); }
        else say("First mirror point " + pt(p) + ". Click a second point.");
        draw();
      }
    });
    ui.svg.addEventListener("pointermove", function (ev) {
      if (!S.drag) return;
      var w = toWorld(ev), dx = w[0] - S.drag.start[0], dy = w[1] - S.drag.start[1];
      if (S.snap) { dx = Math.round(dx); dy = Math.round(dy); } else { dx = Math.round(dx * 100) / 100; dy = Math.round(dy * 100) / 100; }
      S.drag.dx = dx; S.drag.dy = dy; S.drag.M = mul(translation(dx, dy), S.drag.M0); draw();
    });
    function endDrag() {
      var d = S.drag; if (!d) return; S.drag = null;
      if (d.dx || d.dy) { S.history.push({ M: S.M, n: S.log.length }); finish(d.M, slideText(d.dx, d.dy)); } else draw();
    }
    ui.svg.addEventListener("pointerup", endDrag);
    ui.svg.addEventListener("pointercancel", function () { S.drag = null; draw(); });
    var lastKey = 0;
    ui.svg.addEventListener("keydown", function (ev) {
      var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key];
      if (!d || !S.paper || S.busy) return;
      ev.preventDefault();
      var now = Date.now(), M2 = mul(translation(d[0], d[1]), S.M);
      if (now - lastKey < 800 && S.log.length && /^slide /.test(S.log[S.log.length - 1]) && S.history.length) {
        var prev = S.history[S.history.length - 1].M, dd = [S.M.e + d[0] - prev.e, S.M.f + d[1] - prev.f];
        S.M = clean(M2); S.log[S.log.length - 1] = slideText(dd[0], dd[1]); draw();
      } else { S.history.push({ M: S.M, n: S.log.length }); finish(M2, slideText(d[0], d[1])); }
      lastKey = now;
    });

    showTab("paper");
    setPreset(Math.max(0, presets.findIndex(function (p) { return p.id === opts.preset; })));

    return {
      setPreset: function (idOrIndex) {
        var i = typeof idOrIndex === "number" ? idOrIndex : presets.findIndex(function (p) { return p.id === idOrIndex; });
        if (i >= 0) setPreset(i);
      },
      state: function () { S.cell = CELL; return S; },
      destroy: function () { window.removeEventListener("resize", pinTop); host.innerHTML = ""; host.classList.remove("tp-root"); },
    };
  }

  // ------------------------------------------------------------------ modal wrapper (used by the book plugin)
  function openModal(opts) {
    var prev = document.activeElement;
    var overlay = el("div", { class: "tp-overlay" });
    var dlg = el("div", { class: "tp-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Tracing paper" });
    var close = el("button", { type: "button", class: "tp-btn tp-close", text: "Close", "aria-label": "Close tracing paper" });
    var host = el("div", { class: "tp-host" });
    dlg.appendChild(close); dlg.appendChild(host); overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    var inst = mount(host, opts);
    function shut() {
      document.removeEventListener("keydown", onKey, true);
      inst.destroy(); overlay.remove(); if (prev && prev.focus) prev.focus();
      if (opts && opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); shut(); } }
    document.addEventListener("keydown", onKey, true);
    close.addEventListener("click", shut);
    close.focus();
    inst.close = shut;
    return inst;
  }

  return {
    mount: mount, openModal: openModal,
    _math: { ID: ID, mul: mul, apply: apply, inv: inv, det: det, clean: clean, translation: translation, rotation: rotation, reflection: reflection,
      lineFrom: lineFrom, lineText: lineText, slideText: slideText, parsePoints: parsePoints, samePointSet: samePointSet },
  };
});
