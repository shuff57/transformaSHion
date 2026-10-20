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


@pytest.fixture()
def page(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    yield pg
    assert errors == [], errors
    ctx.close()


def open_preset(pg, preset):
    pg.goto(INDEX.as_uri() + "?preset=" + preset)
    pg.wait_for_selector(".tp-svg")


def click(pg, text):
    pg.get_by_role("button", name=text).first.click()


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
    click(page, "Trace the figure")
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
    click(page, "Trace the figure")
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
    click(page, "Trace the figure")
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
    click(page, "Trace the figure")
    assert "(4, 2)" in page.locator(".tp-val").first.inner_text()
    click(page, "counterclockwise")
    assert now_points(page) == [(4, 5), (0, 2), (2, -1)]
    click(page, "Put the paper back")
    page.get_by_role("button", name="\u21bb clockwise", exact=True).click()
    assert now_points(page) == [(4, -1), (8, 2), (6, 5)]


def test_kite_turn_and_slide_and_flip(page):
    open_preset(page, "kite")
    click(page, "Lay tracing paper")
    click(page, "Trace the figure")
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
    assert "Type points like" in page.locator(".tp-checkmsg").inner_text()
    assert page.locator(".tp-moves li").all_inner_texts() == ["none yet"]


def test_animated_flip_lands_exactly(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})        # motion allowed
    pg = ctx.new_page()
    open_preset(pg, "triangle-mirror")
    click(pg, "Lay tracing paper")
    click(pg, "Trace the figure")
    click(pg, "Use x = 5")
    click(pg, "Flip the paper over the mirror")
    pg.wait_for_timeout(120)
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
        click(page, "Trace the figure")
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
