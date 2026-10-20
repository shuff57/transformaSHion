"""Drive the Tracing Paper tool in a real browser and compare every readout with known answers.

    python3 -m pytest tests -q          (needs: pip install pytest playwright; playwright install chromium)

Moves run with reduced motion so each one lands instantly; one test runs the animated path.
The expected coordinates are the worked cases of Integrated Math 1 section 3.1.
"""
import pathlib
import re

import pytest
from playwright.sync_api import sync_playwright

INDEX = pathlib.Path(__file__).resolve().parents[1] / "index.html"
MINUS = "−"


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


class Revealing:
    """A locator whose actions first open the control tab it lives in, as a person would."""

    def __init__(self, loc, pg):
        self._loc, self._pg = loc, pg

    def _open(self):
        if self._loc.count() == 0:                    # role queries skip hidden controls: try each tab until it shows up
            for tab in self._pg.locator(".tp-tab").all():
                tab.click()
                if self._loc.count():
                    return
            return
        tab = self._loc.first.evaluate("e => { const p = e.closest('.tp-panel'); return p && p.hidden ? p.id.replace('-p-', '-t-') : null; }")
        if tab:
            self._pg.locator("#" + tab).click()

    def __getattr__(self, name):
        attr = getattr(self._loc, name)
        if name in ("click", "fill", "check", "uncheck", "select_option", "is_disabled", "is_enabled", "inner_text", "text_content", "is_checked"):
            def go(*a, **k):
                self._open()
                return attr(*a, **k)
            return go
        if name == "first":
            return Revealing(attr, self._pg)
        return attr


class Tabbed:
    """The page, with get_by_* locators that open the right tab before acting."""

    def __init__(self, pg):
        self._pg = pg

    def __getattr__(self, name):
        attr = getattr(self._pg, name)
        if name.startswith("get_by_"):
            return lambda *a, **k: Revealing(attr(*a, **k), self._pg)
        return attr


@pytest.fixture()
def page(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    yield Tabbed(pg)
    assert errors == [], errors
    ctx.close()


def open_preset(pg, preset):
    pg.goto(INDEX.as_uri() + "?preset=" + preset)
    pg.wait_for_selector(".tp-svg")


def click(pg, text):
    pg.get_by_role("button", name=text).first.click()


def plot_shape(pg):
    """Plot the setup's own figure the way a student would, here by typing its corners."""
    pts = pg.evaluate("() => window.tracingPaper.state().P.shapes.filter(s => s.role !== 'ref').flatMap(s => s.pts)")
    pg.get_by_label("Your shape's corner points").fill(", ".join("(%s, %s)" % (x, y) for x, y in pts))


def trace(pg):
    plot_shape(pg)
    click(pg, "Trace my shape")


def now_points(pg):
    """The 'Now at' column as a list of (x, y) numbers."""
    cells = pg.locator(".tp-table tbody tr td:nth-child(3)").all_inner_texts()
    out = []
    for c in cells:
        a, b = re.findall(r"-?\d+(?:\.\d+)?", c.replace(MINUS, "-"))
        out.append((float(a), float(b)))
    return out


def set_num(pg, label, value):
    pg.get_by_label(label, exact=True).fill(str(value))


def svg_click(pg, x, y, drag_to=None):
    """Click (or drag) at world coordinates by mapping through the svg's own box."""
    box = pg.evaluate("""() => { const s = document.querySelector('.tp-svg'); const r = s.getBoundingClientRect(); const vb = s.viewBox.baseVal;
        return {left: r.left, top: r.top, w: r.width, h: r.height, vw: vb.width, vh: vb.height}; }""")
    xr, yr, cell = pg.evaluate("() => { const S = window.tracingPaper.state(); return [S.P.xr, S.P.yr, S.cell]; }")

    def at(wx, wy):
        vx, vy = 40 + (wx - xr[0]) * cell, 20 + (yr[1] - wy) * cell
        return box["left"] + vx * box["w"] / box["vw"], box["top"] + vy * box["h"] / box["vh"]

    sx, sy = at(x, y)
    pg.mouse.move(sx, sy)
    pg.mouse.down()
    if drag_to:
        ex, ey = at(*drag_to)
        pg.mouse.move((sx + ex) / 2, (sy + ey) / 2)
        pg.mouse.move(ex, ey)
    pg.mouse.up()


def test_math_exact():
    """The matrix pieces, with no browser UI involved."""
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(INDEX.as_uri())
        got = pg.evaluate("""() => { const m = TracingPaper._math;
            const flip5 = m.reflection(m.lineFrom({type:'v', a:5}));
            const turn = m.rotation([14,10], 90);
            const two = m.mul(m.reflection(m.lineFrom({type:'v', a:6})), m.reflection(m.lineFrom({type:'v', a:2})));
            const xy = m.mul(m.reflection(m.lineFrom({type:'diag'})), m.reflection(m.lineFrom({type:'h', b:0})));
            return { flip: m.apply(m.clean(flip5), [1,2]), turn: m.apply(m.clean(turn), [14,18]), turnB: m.apply(m.clean(turn), [8,12]),
                     slide: m.apply(m.clean(two), [-1,1]), quarter: m.apply(m.clean(xy), [2,1]),
                     roundtrip: m.apply(m.inv(m.clean(turn)), m.apply(m.clean(turn), [3,4])),
                     det: [m.det(flip5), m.det(turn), m.det(two)],
                     text: [m.lineText(m.lineFrom({type:'diag'})), m.lineText(m.lineFrom({type:'line', p:[0,0], q:[4,2]})),
                            m.lineText(m.lineFrom({type:'line', p:[2,1], q:[3,-1]})), m.slideText(8,0), m.slideText(-3,2)],
                     pts: m.parsePoints('(9, 2), (6,2) , (-1.5, 3)') }; }""")
        b.close()
    assert got["flip"] == [9, 2]
    assert got["turn"] == [6, 10] and got["turnB"] == [12, 4]
    assert got["slide"] == [7, 1]                      # two parallel flips, gap 4, slide 8
    assert got["quarter"] == [-1, 2]                   # x-axis then y = x: quarter turn counterclockwise
    assert all(abs(a - b) < 1e-9 for a, b in zip(got["roundtrip"], [3, 4]))
    assert [round(d) for d in got["det"]] == [-1, 1, 1]
    assert got["text"][0] == "y = x"
    assert got["text"][1] == "y = (1/2)x"
    assert got["text"][2] == "y = −2x + 5"
    assert got["text"][3] == "slide right 8" and got["text"][4] == "slide left 3, up 2"
    assert got["pts"] == [[9, 2], [6, 2], [-1.5, 3]]


def test_flip_over_mirror_and_undo(page):
    open_preset(page, "triangle-mirror")
    click(page, "Lay tracing paper")
    trace(page)
    assert now_points(page) == [(1, 2), (4, 2), (1, 6)]
    click(page, "Use x = 5")
    click(page, "Flip the paper over the mirror")
    assert now_points(page) == [(9, 2), (6, 2), (9, 6)]
    assert page.locator(".tp-moves li").all_inner_texts() == ["flip over x = 5"]
    assert page.locator(".tp-paper.tp-back").count() == 1          # the paper is drawn face down after a flip
    click(page, "Undo last move")
    assert now_points(page) == [(1, 2), (4, 2), (1, 6)]
    assert page.locator(".tp-paper.tp-back").count() == 0


def test_parallel_mirrors_make_a_slide_of_twice_the_gap(page):
    open_preset(page, "parallel")
    click(page, "Lay tracing paper")
    trace(page)
    click(page, "Use x = 2")
    click(page, "Flip the paper over the mirror")
    assert now_points(page) == [(5, 1), (5, 4), (3, 1)]
    click(page, "Use x = 6")
    click(page, "Flip the paper over the mirror")
    assert now_points(page) == [(7, 1), (7, 4), (9, 1)]
    moved = page.locator(".tp-table tbody tr td:nth-child(4)").all_inner_texts()
    assert moved == ["right 8"] * 3


def test_crossing_mirrors_order_sets_the_direction(page):
    open_preset(page, "crossing")
    click(page, "Lay tracing paper")
    trace(page)
    click(page, "Use y = 0")
    click(page, "Flip the paper over the mirror")
    page.get_by_role("button", name="y = x", exact=True).click()
    click(page, "Flip the paper over the mirror")
    assert now_points(page) == [(-1, 2), (-1, 6), (-4, 2)]          # quarter turn counterclockwise
    click(page, "Put the paper back")
    page.get_by_role("button", name="y = x", exact=True).click()
    click(page, "Flip the paper over the mirror")
    click(page, "Use y = 0")
    click(page, "Flip the paper over the mirror")
    assert now_points(page) == [(1, -2), (1, -6), (4, -2)]          # reversed order: clockwise
    click(page, "Put the paper back")
    click(page, "Use y = 0")
    click(page, "Flip the paper over the mirror")
    click(page, "Use x = 0")
    click(page, "Flip the paper over the mirror")
    assert now_points(page) == [(-2, -1), (-6, -1), (-2, -4)]       # half turn


def test_turn_about_a_center_that_is_not_the_origin(page):
    open_preset(page, "turn")
    click(page, "Lay tracing paper")
    trace(page)
    assert "(4, 2)" in page.locator(".tp-val").first.inner_text()
    click(page, "counterclockwise")
    assert now_points(page) == [(4, 5), (0, 2), (2, -1)]
    click(page, "Put the paper back")
    page.get_by_role("button", name="\u21bb clockwise", exact=True).click()
    assert now_points(page) == [(4, -1), (8, 2), (6, 5)]


def test_kite_turn_and_slide_and_flip(page):
    open_preset(page, "kite")
    click(page, "Lay tracing paper")
    trace(page)
    click(page, "counterclockwise")
    got = now_points(page)
    assert got[0] == (6, 10) and got[1] == (12, 4) and got[4] == (22, 10)
    click(page, "Put the paper back")
    set_num(page, "slide right by", 10)
    set_num(page, "slide up by", 2)
    click(page, "Slide")
    assert now_points(page)[0] == (24, 20)
    click(page, "Put the paper back")
    click(page, "Use x = 22")
    click(page, "Flip the paper over the mirror")
    got = now_points(page)
    assert got[0] == (30, 18) and got[1] == (36, 12)


def test_drag_keyboard_and_marks(page):
    open_preset(page, "blank")
    click(page, "Lay tracing paper")
    page.get_by_text("Mark points", exact=True).click()
    svg_click(page, 3, 3)
    svg_click(page, 5, 3)
    svg_click(page, 3, 6)
    assert now_points(page) == [(3, 3), (5, 3), (3, 6)]
    page.get_by_text("Drag the paper", exact=True).click()
    svg_click(page, 0, 0, drag_to=(4, -2))                          # drag right 4 and down 2
    assert now_points(page) == [(7, 1), (9, 1), (7, 4)]
    assert page.locator(".tp-moves li").all_inner_texts() == ["slide right 4, down 2"]
    page.locator(".tp-svg").focus()
    page.keyboard.press("ArrowUp")
    page.keyboard.press("ArrowUp")
    assert now_points(page) == [(7, 3), (9, 3), (7, 6)]
    page.get_by_text("Pick a center", exact=True).click()
    svg_click(page, 2, 2)
    assert "(2, 2)" in page.locator(".tp-val").first.inner_text()
    page.get_by_text("Pick a mirror (two points)", exact=True).click()
    svg_click(page, 0, 0)
    svg_click(page, 4, 2)
    assert page.locator(".tp-val").nth(1).inner_text() == "y = (1/2)x"


def test_check_never_gives_the_answer(page):
    open_preset(page, "triangle-mirror")
    page.get_by_label("Your predicted image points").fill("(9, 2), (6, 2), (9, 6)")
    click(page, "Check")
    assert page.locator(".tp-checkmsg").inner_text().startswith("Matches")
    page.get_by_label("Your predicted image points").fill("(9, 2), (6, 2), (9, 5)")
    click(page, "Check")
    msg = page.locator(".tp-checkmsg").inner_text()
    assert msg.startswith("Does not match") and "(9, 6)" not in msg
    page.get_by_label("Your predicted image points").fill("(9, 2)")
    click(page, "Check")
    assert "one point for each corner" in page.locator(".tp-checkmsg").inner_text()
    page.get_by_label("Your predicted image points").fill("nine, two")
    click(page, "Check")
    assert "type them like" in page.locator(".tp-checkmsg").inner_text()
    assert page.locator(".tp-moves li").all_inner_texts() == ["none yet"]


def test_animated_flip_lands_exactly(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})        # motion allowed
    pg = Tabbed(ctx.new_page())
    open_preset(pg, "triangle-mirror")
    click(pg, "Lay tracing paper")
    trace(pg)
    click(pg, "Use x = 5")
    click(pg, "Flip the paper over the mirror")
    assert pg.get_by_role("button", name="Undo last move").is_disabled()       # busy while folding
    pg.wait_for_function("() => document.querySelectorAll('.tp-moves li:not(.tp-none)').length === 1", timeout=3000)
    assert now_points(pg) == [(9, 2), (6, 2), (9, 6)]
    ctx.close()


def test_modal_opens_closes_and_restores_focus(page):
    page.goto(INDEX.as_uri())
    page.evaluate("""() => { const b = document.createElement('button'); b.id = 'opener'; b.textContent = 'open'; document.body.appendChild(b); b.focus(); }""")
    page.evaluate("() => TracingPaper.openModal({ presets: TRACING_PAPER_PRESETS, preset: 'parallel' })")
    assert page.get_by_role("dialog").count() == 1
    assert page.locator(".tp-dialog .tp-title").inner_text() == "Two flips, parallel mirrors"
    page.keyboard.press("Escape")
    assert page.get_by_role("dialog").count() == 0
    assert page.evaluate("() => document.activeElement.id") == "opener"


def test_screenshots_for_a_look(page, tmp_path_factory):
    out = pathlib.Path(__import__("os").environ.get("TP_SHOTS", ""))
    if not out.as_posix() or not out.is_dir():
        pytest.skip("set TP_SHOTS to a directory to write screenshots")
    for theme in ("light", "dark"):
        page.emulate_media(color_scheme=theme)
        open_preset(page, "parallel")
        page.evaluate("t => document.documentElement.setAttribute('data-theme', t)", theme)
        click(page, "Lay tracing paper")
        trace(page)
        click(page, "Use x = 2")
        click(page, "Flip the paper over the mirror")
        click(page, "Use x = 6")
        click(page, "Flip the paper over the mirror")
        page.screenshot(path=str(out / f"tp_parallel_{theme}.png"), full_page=True)


def test_wide_grids_keep_readable_text(page):
    """The kite grid is 40 wide; the drawing scales its squares so tick numbers stay near 12px on screen."""
    open_preset(page, "kite")
    px = page.evaluate("""() => { const s = document.querySelector('.tp-svg'); const t = s.querySelector('.tp-tick');
        return parseFloat(getComputedStyle(t).fontSize) * s.getBoundingClientRect().width / s.viewBox.baseVal.width; }""")
    assert px >= 10, px


def test_messages_name_the_missing_step_in_order(page):
    open_preset(page, "triangle-mirror")
    click(page, "Flip the paper over the mirror")
    assert page.locator(".tp-live").inner_text() == "Lay the tracing paper on the grid first."
    click(page, "counterclockwise")
    assert page.locator(".tp-live").inner_text() == "Lay the tracing paper on the grid first."
    click(page, "Lay tracing paper")
    click(page, "Flip the paper over the mirror")
    assert page.locator(".tp-live").inner_text() == "Pick a mirror first."
    click(page, "counterclockwise")
    assert page.locator(".tp-live").inner_text() == "Pick a center first."


def test_floating_button_is_styled_outside_the_dialog(browser):
    """The plugin's floating button lives on the host page, outside .tp-root; its color tokens must still resolve."""
    pg = browser.new_page()
    pg.set_content("<!doctype html><body><p>host page</p></body>")
    pg.add_style_tag(path=str(INDEX.parent / "src" / "tracing-paper.css"))
    pg.evaluate("() => { const b = document.createElement('button'); b.className = 'tp-btn tp-fab'; b.textContent = 'Tracing paper'; document.body.appendChild(b); }")
    border = pg.evaluate("() => getComputedStyle(document.querySelector('.tp-fab')).borderTopColor")
    assert border == "rgb(80, 78, 73)", border          # --tp-axis; an undefined token falls back to black
    pg.close()


def test_tabs_show_one_group_and_follow_the_keyboard(page):
    open_preset(page, "triangle-mirror")
    tabs = page.locator(".tp-tab")
    assert tabs.all_inner_texts() == ["Paper", "Slide", "Turn", "Flip", "Check"]
    assert page.locator(".tp-panel:not([hidden])").count() == 1                 # one control group at a time
    page.locator(".tp-tab[aria-selected=true]").focus()
    page.keyboard.press("ArrowRight")
    assert page.locator(".tp-tab[aria-selected=true]").inner_text() == "Slide"
    page.keyboard.press("End")
    assert page.locator(".tp-tab[aria-selected=true]").inner_text() == "Check"
    page.keyboard.press("Home")
    assert page.locator(".tp-tab[aria-selected=true]").inner_text() == "Paper"
    open_preset(page, "blank")                                                  # a setup with no checks has no Check tab
    assert page.locator(".tp-tab", has_text="Check").is_hidden()


def test_picking_a_center_or_mirror_on_the_grid_opens_its_tab(page):
    open_preset(page, "triangle-mirror")
    page.get_by_text("Pick a center", exact=True).click()
    svg_click(page, 3, 3)
    assert page.locator(".tp-tab[aria-selected=true]").inner_text() == "Turn"
    page.locator("#" + page.locator(".tp-tab", has_text="Paper").get_attribute("id")).click()
    page.get_by_text("Pick a mirror (two points)", exact=True).click()
    svg_click(page, 1, 1)
    svg_click(page, 4, 4)
    assert page.locator(".tp-tab[aria-selected=true]").inner_text() == "Flip"


def test_grid_stays_pinned_and_the_page_theme_wins_over_the_os(browser):
    ctx = browser.new_context(viewport={"width": 390, "height": 700}, reduced_motion="reduce", color_scheme="dark")
    pg = ctx.new_page()
    pg.goto(INDEX.as_uri() + "?preset=triangle-mirror")
    pg.wait_for_selector(".tp-svg")
    assert pg.evaluate("() => getComputedStyle(document.querySelector('.tp-pin')).position") == "sticky"
    dark = pg.evaluate("() => getComputedStyle(document.querySelector('.tp-root')).getPropertyValue('--tp-bg').trim()")
    pg.evaluate("() => document.documentElement.classList.add('tp-page-themed')")      # a host page that does its own theming
    light = pg.evaluate("() => getComputedStyle(document.querySelector('.tp-root')).getPropertyValue('--tp-bg').trim()")
    assert dark == "#26241d" and light == "#f5f3ea", (dark, light)
    ctx.close()


def test_plot_a_prediction_on_the_grid_and_check_before_moving(page):
    """Plot the predicted image by clicking the grid, check it, and never touch the paper."""
    open_preset(page, "triangle-mirror")
    page.get_by_text("Plot a prediction", exact=True).click()
    assert page.locator(".tp-tab[aria-selected=true]").inner_text() == "Check"
    for x, y in ((9, 2), (6, 2), (9, 5)):                                       # one corner is wrong
        svg_click(page, x, y)
    assert page.get_by_label("Your predicted image points").input_value() == "(9, 2), (6, 2), (9, 5)"
    assert page.locator(".tp-pred").count() == 3
    click(page, "Check")
    assert page.locator(".tp-checkmsg").inner_text().startswith("Does not match yet")
    svg_click(page, 9, 5)                                                       # click it again to remove it
    assert page.locator(".tp-pred").count() == 2
    svg_click(page, 9, 6)
    click(page, "Check")
    assert page.locator(".tp-checkmsg").inner_text().startswith("Matches")
    assert page.locator(".tp-pred-ok").count() == 3
    assert page.evaluate("() => window.tracingPaper.state().paper") is False     # all of that happened before any move
    svg_click(page, 4, 3)
    assert page.locator(".tp-pred-ok").count() == 0                              # changing the points clears the verdict
    click(page, "Clear my points")
    assert page.locator(".tp-pred").count() == 0


def test_typing_points_plots_them_and_blank_setup_has_no_predict_mode(page):
    open_preset(page, "triangle-mirror")
    page.get_by_label("Your predicted image points").fill("(9, 2), (6, 2)")
    assert page.locator(".tp-pred").count() == 2
    open_preset(page, "blank")
    assert page.get_by_text("Plot a prediction", exact=True).is_hidden()


def test_student_plots_the_shape_by_clicking_and_checks_it(page):
    """Nothing is pre-plotted: the grid starts empty, the student clicks the corners, then checks the shape."""
    open_preset(page, "triangle-mirror")
    assert page.locator(".tp-pre").count() == 0 and page.locator(".tp-fv").count() == 0
    assert "(1, 2), (4, 2), (1, 6)" in page.locator(".tp-hint").first.inner_text()
    click(page, "Lay tracing paper")
    click(page, "Trace my shape")
    assert page.locator(".tp-live").inner_text() == "Plot the shape on the grid first."
    for x, y in ((1, 2), (4, 2), (1, 5)):                                         # one corner wrong
        svg_click(page, x, y)
    assert page.locator(".tp-fv").count() == 3
    click(page, "Check my shape")
    assert page.locator(".tp-shapemsg").inner_text().startswith("Does not match yet")
    svg_click(page, 1, 5)                                                         # remove it, plot the right one
    svg_click(page, 1, 6)
    click(page, "Close the shape")
    assert page.locator("polygon.tp-pre").count() == 1
    click(page, "Check my shape")
    assert page.locator(".tp-shapemsg").inner_text().startswith("Matches")
    click(page, "Trace my shape")
    assert now_points(page) == [(1, 2), (4, 2), (1, 6)]


def test_free_setup_lets_students_plot_any_shape_and_hides_checking(page):
    open_preset(page, "blank")
    assert page.get_by_role("button", name="Check my shape").count() == 0
    for x, y in ((-3, 1), (2, 1), (2, 4), (-3, 4)):
        svg_click(page, x, y)
    click(page, "Close the shape")
    click(page, "Lay tracing paper")
    click(page, "Trace my shape")
    assert now_points(page) == [(-3, 1), (2, 1), (2, 4), (-3, 4)]
    click(page, "Slide")
    assert now_points(page) == [(1, 1), (6, 1), (6, 4), (1, 4)]                 # the default slide is right 4
