"""Browser tests for the plotter plugin (plain graphing grid + optional paper), driven in Chromium.

Every tool, snapping, erase, paper mark / slide / turn / flip, reset, Check match / no match, no answer in the DOM,
light and dark, 320 px width. The page is served from a temp docs dir; `raw.html` mounts the tool directly with a test
preset whose hidden target is deliberately odd so a leak is easy to spot.
"""
import functools
import http.server
import json
import re
import threading
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api")
PLUGIN = Path(__file__).resolve().parent.parent / "src"
SECRET = [[7, -3], [8, -3], [7, -5]]            # target after the test's flip over x = 0 ... see test_check
TEST_PRESETS = [
    {"id": "t", "title": "Test grid", "xr": [-10, 10], "yr": [-10, 10], "note": "n"},
    # the paper's marks after flipping over the y-axis (x = 0) land here
    {"id": "chk", "title": "Check grid", "xr": [-10, 10], "yr": [-10, 10], "target": [[-7, 3], [-8, 3], [-7, 5]]},
    {"id": "chk2", "title": "Two answers", "xr": [-10, 10], "yr": [-10, 10],       # a preset may accept more than one result
     "targets": [[[-7, 3], [-8, 3], [-7, 5]], [[7, 3], [8, 3], [7, 5]]]},
    {"id": "tiny", "title": "Small", "xr": [0, 5], "yr": [0, 5]},
]


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    d = tmp_path_factory.mktemp("docs")
    (d / "plotter").mkdir()
    for f in ("plotter.js", "plotter.css"):
        (d / "plotter" / f).write_text((PLUGIN / f).read_text(encoding="utf-8"), encoding="utf-8")
    (d / "raw.html").write_text(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<link rel="stylesheet" href="plotter/plotter.css"><style>body{margin:0;padding:8px;background:#faf9f5}'
        'html[data-theme=dark] body{background:#141413}</style></head><body>'
        '<div id="host"></div><script src="plotter/plotter.js"></script><script>'
        "var q=new URLSearchParams(location.search);document.documentElement.classList.add('pl-page-themed');"
        "if(q.get('theme'))document.documentElement.setAttribute('data-theme',q.get('theme'));"
        "window.Plotter.mount(document.getElementById('host'),{presets:" + json.dumps(TEST_PRESETS) + ",preset:q.get('p')||'t'});"
        "</script></body></html>", encoding="utf-8")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(d))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


class Grid:
    def __init__(self, page):
        self.pg = page
        self.svg = page.locator("svg.pl-svg")

    def at(self, x, y):
        a = self.svg
        u, m = float(a.get_attribute("data-u")), float(a.get_attribute("data-m"))
        xmin, ymax = float(a.get_attribute("data-xmin")), float(a.get_attribute("data-ymax"))
        vb = a.evaluate("e => e.viewBox.baseVal.width")
        box = a.bounding_box()
        k = box["width"] / vb
        return box["x"] + (m + (x - xmin) * u) * k, box["y"] + (m + (ymax - y) * u) * k

    def click(self, x, y, dx=0, dy=0):
        sx, sy = self.at(x, y)
        self.pg.mouse.click(sx + dx, sy + dy)

    def drag(self, a, b, steps=8):
        ax, ay = self.at(*a)
        bx, by = self.at(*b)
        self.pg.mouse.move(ax, ay)
        self.pg.mouse.down()
        self.pg.mouse.move(bx, by, steps=steps)
        self.pg.mouse.up()

    def tool(self, name):
        self.pg.get_by_role("button", name=name, exact=True).click()

    def items(self):
        return [(e.get_attribute("data-kind"), e.get_attribute("data-pts")) for e in self.pg.locator(".pl-item").all()]

    def marks(self):
        return sorted((float(m.get_attribute("data-x")), float(m.get_attribute("data-y"))) for m in self.pg.locator(".pl-mark").all())

    def status(self):
        return self.pg.locator(".pl-status").inner_text()

    def moves(self):
        return self.pg.locator(".pl-moves li").all_inner_texts()

    def paper_on(self):
        self.tool("Paper")


@pytest.fixture
def grid(browser, site):
    pg = browser.new_page(viewport={"width": 900, "height": 1000})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(site + "/raw.html")
    pg.wait_for_selector("svg.pl-svg")
    g = Grid(pg)
    yield g
    assert errs == []
    pg.close()


def near(a, b, eps=1e-3):
    return len(a) == len(b) and all(abs(p[0] - q[0]) < eps and abs(p[1] - q[1]) < eps for p, q in zip(a, b))


# ---------------------------------------------------------------- drawing tools
def test_point_snaps_to_the_nearest_crossing(grid):
    grid.tool("Dot")
    grid.click(2, 3, dx=6, dy=-5)                       # off the crossing, still nearest to (2, 3)
    assert grid.items() == [("point", "2,3")]
    grid.click(2, 3)                                    # duplicate is refused
    assert len(grid.items()) == 1


def test_line_is_drawn_through_both_points_and_keeps_going(grid):
    grid.tool("Line")
    grid.click(0, 0)
    assert grid.items() == []                           # one click is only pending
    grid.click(2, 1)
    assert grid.items() == [("line", "0,0;2,1")]
    x1, x2 = grid.pg.eval_on_selector(".pl-item line.pl-shape", "e => [+e.getAttribute('x1'), +e.getAttribute('x2')]")
    vb = grid.svg.evaluate("e => e.viewBox.baseVal.width")
    assert x1 < 0 and x2 > vb                           # runs past the edges of the grid


def test_polygon_closes_on_the_first_corner(grid):
    grid.tool("Polygon")
    for p in [(1, 1), (4, 1), (1, 5)]:
        grid.click(*p)
    assert grid.items() == []
    assert grid.pg.get_by_role("button", name="Close polygon").is_visible()
    grid.click(1, 1)
    assert grid.items() == [("polygon", "1,1;4,1;1,5")]
    assert not grid.pg.get_by_role("button", name="Close polygon").is_visible()
    assert grid.pg.locator(".pl-item[data-kind=polygon] rect.pl-anchor").count() == 3


def test_polygon_closes_with_the_button_and_the_keyboard(grid):
    grid.tool("Polygon")
    for p in [(-2, -2), (-5, -2), (-5, -6), (-2, -6)]:
        grid.click(*p)
    grid.pg.get_by_role("button", name="Close polygon").focus()
    grid.pg.keyboard.press("Enter")
    assert grid.items() == [("polygon", "-2,-2;-5,-2;-5,-6;-2,-6")]
    grid.tool("Polygon")
    grid.svg.focus()
    for k in ["ArrowRight", "ArrowRight", "ArrowUp"]:
        grid.pg.keyboard.press(k)
    grid.pg.keyboard.press("Enter")
    grid.pg.keyboard.press("ArrowRight"); grid.pg.keyboard.press("Enter")
    grid.pg.keyboard.press("ArrowUp"); grid.pg.keyboard.press("Enter")
    grid.pg.keyboard.press("ArrowLeft"); grid.pg.keyboard.press("ArrowDown"); grid.pg.keyboard.press("Enter")
    assert grid.items()[-1] == ("polygon", "2,1;3,1;3,2")


def test_erase_removes_a_whole_polygon(grid):
    grid.tool("Polygon")
    for p in [(1, 1), (4, 1), (1, 5), (1, 1)]:
        grid.click(*p)
    grid.tool("Eraser")
    grid.click(2.5, 1, dy=2)                              # on an edge
    assert grid.items() == []


def test_mark_copies_polygon_corners_and_outline_onto_the_paper(grid):
    grid.tool("Polygon")
    for p in [(1, 1), (4, 1), (1, 5), (1, 1)]:
        grid.click(*p)
    grid.paper_on(); grid.tool("Mark on paper")
    grid.click(1, 5)                                      # a corner: just that corner
    assert near(grid.marks(), [(1, 5)]) and grid.pg.locator(".pl-markpoly").count() == 0
    grid.click(2.5, 1, dy=2)                              # an edge: the whole polygon
    assert near(grid.marks(), [(1, 1), (1, 5), (4, 1)])
    assert grid.pg.locator(".pl-markpoly").count() == 1
    grid.click(2.5, 1, dy=2)                              # again changes nothing
    assert len(grid.marks()) == 3 and grid.pg.locator(".pl-markpoly").count() == 1
    grid.tool("Slide"); grid.drag((0, 0), (2, 3))
    assert near(grid.marks(), [(3, 4), (3, 8), (6, 4)])
    grid.pg.get_by_role("button", name="Clear marks").click()
    assert grid.marks() == [] and grid.pg.locator(".pl-markpoly").count() == 0


def test_erase_removes_one_item_and_clear_all_removes_the_rest(grid):
    grid.tool("Dot"); grid.click(5, 5); grid.click(-5, 5)
    grid.tool("Line"); grid.click(0, -4); grid.click(6, -4)
    n = len(grid.items())
    assert n == 3
    grid.tool("Eraser")
    grid.click(5, 5, dx=4)
    assert len(grid.items()) == n - 1 and ("point", "5,5") not in grid.items()
    grid.click(3, -4, dy=3)                              # the middle of the segment
    assert all(k != "line" for k, _ in grid.items())
    grid.tool("Clear All")
    assert grid.items() == []


def test_toolbar_matches_the_myopenmath_layout(grid):
    pg = grid.pg
    row = pg.locator("[aria-label='Drawing tools']")
    texts = row.evaluate("e => [...e.children].map(c => c.getAttribute('aria-label') || c.textContent.trim())")
    assert texts == ["Clear All", "Draw:", "Line", "Dot", "Polygon", "Eraser", "Close polygon", "Paper"]
    side = pg.evaluate("() => { const g = document.querySelector('.pl-side button[data-key=settings]').getBoundingClientRect(), s = document.querySelector('.pl-svg').getBoundingClientRect(); return g.left >= s.right; }")
    assert side                                                        # Settings is the one button in the right sidebar, beside the grid
    below = pg.evaluate("() => document.querySelector('.pl-bar').getBoundingClientRect().top >= document.querySelector('.pl-svg').getBoundingClientRect().bottom")
    assert below                                                       # the toolbar sits under the grid
    for gone in ("Segment", "Close polygon", "Erase", "Point"):      # Close polygon only shows with 3 corners
        assert pg.get_by_role("button", name=gone, exact=True).count() == 0
    assert pg.get_by_text("Setup", exact=True).count() == 0 and pg.locator("select, details").count() == 0
    assert pg.locator("input").count() == 4 and pg.locator("[aria-label='Grid size'] input").count() == 4   # only the grid-size boxes
    assert not pg.locator("[aria-label='Paper tools']").is_visible()   # the paper row appears only with the Paper toggle
    assert pg.locator("button[data-key=mark]").count() == 1 and not pg.locator("button[data-key=mark]").is_visible()
    pg.get_by_role("button", name="Paper", exact=True).click()
    names = pg.locator("[aria-label='Paper tools'] button:visible").evaluate_all("els => els.map(e => e.getAttribute('aria-label') || e.textContent.trim())")
    assert names[:4] == ["Mark on paper", "Slide", "Turn", "Flip"] and "Reset paper" in names
    assert pg.locator(".pl-icon svg").count() == 6                     # icon buttons with an svg each: four tools, the paper and settings


def test_line_anchors_are_small_squares_and_dots_are_circles(grid):
    grid.tool("Line"); grid.click(-2, -1); grid.click(2, 1)
    grid.tool("Dot"); grid.click(4, 4)
    assert grid.pg.locator(".pl-item[data-kind=line] rect.pl-anchor").count() == 2
    assert grid.pg.locator(".pl-item[data-kind=point] circle.pl-dot").count() == 1


def test_no_hover_preview_and_no_coordinate_readout(grid):
    grid.tool("Dot")
    sx, sy = grid.at(3, 3)
    grid.pg.mouse.move(sx, sy)
    grid.pg.mouse.move(sx + 5, sy + 4)
    assert grid.pg.locator(".pl-cursor").count() == 0
    grid.click(3, 3)
    assert grid.pg.locator(".pl-plbl, .pl-clbl:visible").count() == 0
    assert grid.status() == ""


def test_every_integer_tick_is_labelled_on_a_small_grid(browser, site):
    pg = browser.new_page()
    pg.goto(site + "/raw.html?p=tiny")
    pg.wait_for_selector("svg.pl-svg")
    labels = pg.locator("text.pl-tick").evaluate_all("els => els.map(e => e.textContent)")
    assert [l for l in labels if l] == ["0", "1", "2", "3", "4", "5", "1", "2", "3", "4", "5"]
    assert pg.locator("line.pl-tickmark").count() == 12
    pg.close()


def test_keyboard_reaches_every_tool_and_places_points(grid):
    pressed = [b.get_attribute("aria-pressed") for b in grid.pg.locator("[aria-label='Drawing tools'] button.pl-tool").all()]
    assert pressed == ["true", "false", "false", "false"]               # Line, Dot, Polygon, Eraser; Line is active
    grid.pg.get_by_role("button", name="Dot", exact=True).focus()
    grid.pg.keyboard.press("Enter")
    assert grid.pg.get_by_role("button", name="Dot", exact=True).get_attribute("aria-pressed") == "true"
    assert grid.pg.get_by_role("button", name="Line", exact=True).get_attribute("aria-pressed") == "false"
    grid.tool("Dot")
    grid.svg.focus()
    for _ in range(3):
        grid.pg.keyboard.press("ArrowRight")
    grid.pg.keyboard.press("ArrowUp")
    grid.pg.keyboard.press("Enter")
    assert grid.items() == [("point", "3,1")]


# ---------------------------------------------------------------- paper
def test_paper_starts_blank_and_nothing_is_copied_by_itself(grid):
    grid.tool("Dot")
    for p in [(1, 1), (4, 1), (1, 5)]:
        grid.click(*p)
    assert grid.pg.locator(".pl-sheet").count() == 0
    grid.paper_on()
    assert grid.pg.locator(".pl-sheet").count() == 1
    assert grid.marks() == []


def test_mark_copies_a_grid_point_or_a_corner_onto_the_paper(grid):
    grid.tool("Line"); grid.click(2, 2); grid.click(5, 2)
    grid.paper_on(); grid.tool("Mark on paper")
    grid.click(2, 2)                                    # a segment corner
    grid.click(-3, -3)                                  # a bare grid point
    grid.click(2, 2)                                    # twice is one mark
    assert near(grid.marks(), [(-3, -3), (2, 2)])


def test_slide_drags_the_paper_by_whole_units_and_reads_it_out(grid):
    grid.paper_on(); grid.tool("Mark on paper"); grid.click(1, 1); grid.click(2, 3)
    grid.tool("Slide")
    grid.drag((0, 0), (3, -2))
    assert near(grid.marks(), [(4, -1), (5, 1)])
    assert grid.moves() == ["Slid 3 right, 2 down"]
    grid.drag((0, 0), (-1, 0))
    assert grid.moves() == ["Slid 2 right, 2 down"]      # slides merge into one net slide


def test_turn_needs_a_center_then_a_handle_drag_snaps_to_15_degrees(grid):
    grid.paper_on(); grid.tool("Mark on paper"); grid.click(4, 0)
    grid.tool("Turn")
    assert "center" in grid.pg.locator(".pl-hint").inner_text()
    assert grid.pg.locator(".pl-handle").count() == 0
    grid.click(0, 0)                                    # the turn center
    assert grid.pg.locator(".pl-handle").count() == 1
    grid.drag((3, 0), (0, 3.2))                         # handle sits 3 units out; drag a quarter turn counterclockwise
    assert near(grid.marks(), [(0, 4)])
    assert grid.moves() == ["Turned 90 degrees counterclockwise about (0, 0)"]
    grid.drag((0, 3), (3 * 0.2588, 3 * 0.9659))        # the handle back 15 degrees, toward clockwise
    assert near(grid.marks(), [(4 * 0.2588, 4 * 0.9659)], 0.02)
    assert re.fullmatch(r"Turned 75 degrees counterclockwise about \(0, 0\)", grid.moves()[0])


def test_turn_buttons_give_the_keyboard_a_way_to_turn(grid):
    grid.paper_on(); grid.tool("Mark on paper"); grid.click(4, 0)
    grid.tool("Turn"); grid.click(0, 0)
    for _ in range(6):
        grid.pg.get_by_role("button", name="Turn paper 15 degrees counterclockwise").click()
    assert near(grid.marks(), [(0, 4)])
    assert grid.moves() == ["Turned 90 degrees counterclockwise about (0, 0)"]


def test_flip_over_a_line_already_on_the_grid(grid):
    grid.tool("Line"); grid.click(0, 0); grid.click(0, 5)
    grid.paper_on(); grid.tool("Mark on paper"); grid.click(3, 2); grid.click(5, -1)
    grid.tool("Flip")
    grid.click(0, 4, dx=3)                              # on the plotted line, not a bare point
    assert near(grid.marks(), [(-5, -1), (-3, 2)])
    assert grid.pg.locator(".pl-sheet").get_attribute("data-side") == "back"
    assert grid.moves() == ["Flipped over the line through (0, 0) and (0, 5)"]


def test_flip_over_two_grid_points(grid):
    grid.paper_on(); grid.tool("Mark on paper"); grid.click(3, 1)
    grid.tool("Flip")
    grid.click(0, 0)
    assert grid.marks() == [(3, 1)]                     # one point is only pending
    grid.click(1, 1)                                    # the line y = x
    assert near(grid.marks(), [(1, 3)])
    grid.tool("Flip"); grid.click(2, 2); grid.click(2, 2)
    assert "different" in grid.status()


def test_reset_puts_the_paper_back_but_keeps_the_marks(grid):
    grid.paper_on(); grid.tool("Mark on paper"); grid.click(1, 2)
    grid.tool("Slide"); grid.drag((0, 0), (4, 4))
    grid.tool("Flip"); grid.click(0, 0); grid.click(0, 3)
    assert not near(grid.marks(), [(1, 2)])
    grid.pg.get_by_role("button", name="Reset paper").click()
    assert near(grid.marks(), [(1, 2)])
    assert grid.moves() == [] and grid.pg.locator(".pl-sheet").get_attribute("data-side") == "front"


def test_the_readout_never_says_which_move_is_right(grid):
    grid.paper_on(); grid.tool("Mark on paper"); grid.click(1, 1)
    grid.tool("Slide"); grid.drag((0, 0), (2, 2))
    text = grid.pg.locator(".pl-root").inner_text().lower()
    for word in ("correct", "right move", "should", "try a", "wrong", "answer"):
        assert word not in text


# ---------------------------------------------------------------- Check
def _flip_marks_over_the_y_axis(g):
    g.tool("Dot")
    for p in [(7, 3), (8, 3), (7, 5)]:
        g.click(*p)
    g.tool("Line"); g.click(0, 0); g.click(0, 4)
    g.paper_on(); g.tool("Mark on paper")
    for p in [(7, 3), (8, 3), (7, 5)]:
        g.click(*p)


@pytest.fixture
def chk(browser, site):
    pg = browser.new_page(viewport={"width": 900, "height": 1000})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(site + "/raw.html?p=chk")
    pg.wait_for_selector("svg.pl-svg")
    yield Grid(pg)
    assert errs == []
    pg.close()


def test_check_says_matches_only_when_the_paper_lands_on_the_target(chk):
    _flip_marks_over_the_y_axis(chk)
    chk.pg.get_by_role("button", name="Check").click()
    assert chk.status() == "Does not match."             # the marks have not moved yet
    chk.tool("Flip"); chk.click(0, 2, dx=2)
    chk.pg.get_by_role("button", name="Check").click()
    assert chk.status() == "Matches."
    assert chk.pg.locator(".pl-status").get_attribute("data-kind") == "check"   # a deck can show Check results and hide the other status lines


def test_check_does_not_match_a_wrong_move(chk):
    _flip_marks_over_the_y_axis(chk)
    chk.tool("Slide"); chk.drag((0, 0), (-14, 0))        # a slide gets x right for one corner pattern but not the shape
    chk.pg.get_by_role("button", name="Check").click()
    assert chk.status() == "Does not match."
    chk.pg.get_by_role("button", name="Reset paper").click()
    chk.tool("Flip"); chk.click(0, 2, dx=2)
    chk.pg.get_by_role("button", name="Check").click()
    assert chk.status() == "Matches."
    chk.tool("Mark on paper"); chk.click(-9, -9)         # an extra mark spoils it
    chk.pg.get_by_role("button", name="Check").click()
    assert chk.status() == "Does not match."


def test_check_is_exact_a_one_unit_miss_does_not_match(chk):
    _flip_marks_over_the_y_axis(chk)
    chk.tool("Flip"); chk.click(0, 2, dx=2)
    chk.tool("Slide"); chk.drag((0, 0), (1, 0))
    chk.pg.get_by_role("button", name="Check").click()
    assert chk.status() == "Does not match."
    chk.drag((0, 0), (-2, 0))                           # now one unit off the other way
    chk.pg.get_by_role("button", name="Check").click()
    assert chk.status() == "Does not match."
    chk.drag((0, 0), (1, 0))                            # and back on target, then one unit up
    chk.drag((0, 0), (0, 1))
    chk.pg.get_by_role("button", name="Check").click()
    assert chk.status() == "Does not match."
    chk.drag((0, 0), (0, -1))
    chk.pg.get_by_role("button", name="Check").click()
    assert chk.status() == "Matches."


def test_a_preset_without_a_target_has_no_check_button(browser, site):
    pg = browser.new_page()
    pg.goto(site + "/raw.html?p=t")
    pg.wait_for_selector("svg.pl-svg")
    pg.get_by_role("button", name="Paper", exact=True).click()
    assert pg.get_by_role("button", name="Check").count() == 0
    pg.close()


def test_the_hidden_target_is_never_in_the_page(chk):
    _flip_marks_over_the_y_axis(chk)
    for _ in range(2):
        chk.pg.get_by_role("button", name="Check").click()
    html = chk.pg.evaluate("() => document.getElementById('host').outerHTML")   # the DOM; the target lives only in script memory
    # the target (-7,3) (-8,3) (-7,5) is not the student's own plotting, so none of its spellings may appear
    assert "target" not in html.lower()
    for bad in ("-8,3;", "-7,5", "(-8, 3)", "(-7, 5)", "-8, 3", "-7, 5"):
        assert bad not in html, bad
    assert "(-7, 5)" not in chk.pg.locator("body").inner_text()
    attrs = chk.pg.evaluate("() => [...document.querySelectorAll('*')].flatMap(e => [...e.attributes].map(a => a.value)).join('|')")
    assert "-8,3" not in attrs and "-7,5" not in attrs


# ---------------------------------------------------------------- look
@pytest.mark.parametrize("theme", ["light", "dark"])
def test_light_and_dark_use_the_book_tokens(browser, site, theme):
    pg = browser.new_page(viewport={"width": 900, "height": 900})
    pg.goto(site + f"/raw.html?theme={theme}")
    pg.wait_for_selector("svg.pl-svg")
    bg = pg.evaluate("() => getComputedStyle(document.querySelector('.pl-root')).backgroundColor")
    ink = pg.evaluate("() => getComputedStyle(document.querySelector('.pl-root')).color")
    assert (bg, ink) == (("rgb(245, 243, 234)", "rgb(20, 20, 19)") if theme == "light" else ("rgb(38, 36, 29)", "rgb(250, 249, 245)"))
    pg.close()


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_320px_has_no_horizontal_overflow_and_44px_targets(browser, site, theme):
    pg = browser.new_page(viewport={"width": 320, "height": 700}, has_touch=True)
    pg.goto(site + f"/raw.html?theme={theme}&p=chk")
    pg.wait_for_selector("svg.pl-svg")
    pg.get_by_role("button", name="Paper", exact=True).click()
    pg.get_by_role("button", name="Turn", exact=True).click()
    pg.locator("button[data-key=settings]").click()                      # the open settings menu must fit too
    assert pg.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    small = pg.evaluate("""() => [...document.querySelectorAll('.pl button, .pl input, .pl select, .pl summary')]
        .filter(e => e.offsetParent).map(e => [e.textContent.trim() || e.id, e.getBoundingClientRect().height, e.getBoundingClientRect().width])
        .filter(([, h, w]) => h < 43.5 || w < 43.5)""")
    assert small == []
    pg.close()


def test_reduced_motion_page_loads_clean(browser, site):
    pg = browser.new_page(reduced_motion="reduce")
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(site + "/raw.html")
    pg.wait_for_selector("svg.pl-svg")
    assert errs == []
    pg.close()


# ---------------------------------------------------------------- paper icon, image to grid, grid size
def test_the_paper_button_is_a_sheet_with_a_dog_ear(grid):
    b = grid.pg.locator("button[data-key=paper]")
    assert b.get_attribute("aria-label") == "Paper" and b.get_attribute("title") == "Paper"
    assert b.inner_text().strip() == ""                                   # an icon, no text
    d = b.locator("svg path").evaluate_all("els => els.map(e => e.getAttribute('d'))")
    assert len(d) == 2 and d[1].startswith("M14 3v5h5")                  # the sheet outline, then the folded corner
    grid.paper_on()
    assert b.get_attribute("aria-pressed") == "true"


def test_mark_image_on_grid_copies_the_moved_polygon_and_dots(grid):
    grid.tool("Polygon")
    for p in [(1, 2), (4, 2), (1, 6), (1, 2)]:
        grid.click(*p)
    assert [k for k, _ in grid.items()] == ["polygon"]
    grid.paper_on(); grid.tool("Mark on paper")
    grid.click(1, 4)                                                     # the polygon's left edge: copies the whole polygon
    grid.click(-3, -3)                                                   # a lone point
    grid.tool("Flip"); grid.click(5, -9); grid.click(5, 9)               # flip over x = 5
    img = grid.pg.get_by_role("button", name="Mark image on grid")
    assert img.is_enabled()
    img.click()
    got = sorted(grid.items())
    assert ("polygon", "9,2;6,2;9,6") in got                            # the flipped triangle, corners in paper order
    assert ("point", "13,-3") in got                                     # the lone mark landed at x = 10 - (-3)
    img.click()                                                          # a second press adds nothing
    assert sorted(grid.items()) == got
    assert "already" in grid.status()


def test_mark_image_on_grid_needs_a_mark(grid):
    grid.paper_on()
    assert grid.pg.get_by_role("button", name="Mark image on grid").is_disabled()


def test_grid_size_can_be_set_and_reset(grid):
    pg = grid.pg
    row = pg.locator("[aria-label='Grid size']")
    gear = pg.locator("button[data-key=settings]")
    assert gear.get_attribute("aria-label") == "Settings" and gear.get_attribute("aria-expanded") == "false"
    assert not row.is_visible()                                          # the grid size lives in the settings menu, closed at first
    gear.click()
    assert row.is_visible() and gear.get_attribute("aria-expanded") == "true"
    assert row.locator("input").evaluate_all("els => els.map(e => e.value)") == ["-10", "10", "-10", "10"]
    beside = pg.evaluate("() => { const m = document.querySelector('.pl-cfg').getBoundingClientRect(), g = document.querySelector('button[data-key=settings]').getBoundingClientRect(); return m.right <= g.left && m.top <= g.top + 1; }")
    assert beside                                                        # narrow: the gear sits in the right sidebar and the menu pops out to the left of it, over the grid
    assert pg.evaluate("() => document.querySelector('.pl-side button[data-key=settings]') !== null and document.querySelector('.pl-main > .pl-svgholder .pl-svg') !== null".replace(" and ", " && "))
    assert pg.evaluate("() => getComputedStyle(document.querySelector('.pl-cfg')).position") == "absolute"   # an overlay, it does not push the page around
    assert pg.evaluate("() => document.activeElement.getAttribute('data-cfg')") == "x0"
    for key, val in (("x0", "-3"), ("x1", "11"), ("y0", "0"), ("y1", "7")):
        row.locator(f"input[data-cfg={key}]").fill(val)
    row.get_by_role("button", name="Set grid", exact=True).click()
    a = grid.svg
    assert [a.get_attribute(n) for n in ("data-xmin", "data-xmax", "data-ymin", "data-ymax")] == ["-3", "11", "0", "7"]
    grid.tool("Dot"); grid.click(9, 6)
    assert grid.items() == [("point", "9,6")]                            # clicks use the new range
    assert not row.is_visible()                                          # narrow: clicking the grid closed the overlay
    gear.click()
    row.locator("input[data-cfg=x1]").fill("-2")
    row.get_by_role("button", name="Set grid", exact=True).click()
    assert a.get_attribute("data-xmax") == "11" and "2 units" in row.inner_text()   # too small: refused, grid unchanged
    row.locator("input[data-cfg=x1]").fill("2.5")
    row.get_by_role("button", name="Set grid", exact=True).click()
    assert a.get_attribute("data-xmax") == "11" and "whole numbers" in row.inner_text()
    row.locator("input[data-cfg=y1]").fill("90")
    row.get_by_role("button", name="Set grid", exact=True).click()
    assert a.get_attribute("data-ymax") == "7"
    row.get_by_role("button", name="Reset grid").click()
    pg.mouse.click(5, 5)                                                 # a click elsewhere closes it too
    assert not row.is_visible()
    gear.click()
    assert row.is_visible()
    row.locator("input[data-cfg=x0]").focus()
    pg.keyboard.press("Escape")                                          # Escape closes the menu and returns focus to the gear
    assert not row.is_visible() and gear.get_attribute("aria-expanded") == "false"
    assert pg.evaluate("() => document.activeElement.getAttribute('data-key')") == "settings"
    assert [a.get_attribute(n) for n in ("data-xmin", "data-xmax", "data-ymin", "data-ymax")] == ["-10", "10", "-10", "10"]
    assert row.locator("input").evaluate_all("els => els.map(e => e.value)") == ["-10", "10", "-10", "10"]


def test_steps_and_paper_tools_sit_under_the_grid_on_narrow_screens(grid):
    assert grid.pg.evaluate("() => !document.querySelector('.pl-movesbox').closest('.pl-left') && !document.querySelector('.pl-pbar').closest('.pl-left')")   # narrow: they keep their place under the grid


def test_wide_screens_keep_the_settings_panel_out_in_a_sidebar(browser, site):
    pg = browser.new_page(viewport={"width": 1280, "height": 800})
    pg.goto(site + "/raw.html?theme=light&p=blank")
    pg.wait_for_selector("svg.pl-svg")
    row = pg.locator("[aria-label='Grid size']")
    gear = pg.locator("button[data-key=settings]")
    assert row.is_visible() and not gear.is_visible()                    # wide: the panel is always out, there is no gear to press
    place = pg.evaluate("() => { const m = document.querySelector('.pl-cfg').getBoundingClientRect(), g = document.querySelector('.pl-svg').getBoundingClientRect(); return [m.left >= g.right, getComputedStyle(document.querySelector('.pl-cfg')).position]; }")
    assert place == [True, "static"]                                     # in the right sidebar, beside the grid and not over it
    for key, val in (("x0", "-3"), ("x1", "11"), ("y0", "0"), ("y1", "7")):
        row.locator(f"input[data-cfg={key}]").fill(val)
    row.get_by_role("button", name="Set grid", exact=True).click()
    a = pg.locator("svg.pl-svg")
    assert [a.get_attribute(n) for n in ("data-xmin", "data-xmax", "data-ymin", "data-ymax")] == ["-3", "11", "0", "7"]
    box = a.bounding_box()
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.click(5, 5)
    assert row.is_visible()                                              # clicking the grid or the page never closes it
    c = pg.evaluate("() => { const r = s => document.querySelector(s).getBoundingClientRect(), g = r('.pl-svg'), b = r('.pl-bar:not(.pl-pbar)'), root = r('.pl-root'); return [g.left + g.width / 2 - (root.left + root.width / 2), b.left + b.width / 2 - (g.left + g.width / 2)]; }")
    assert abs(c[0]) < 2 and abs(c[1]) < 2                               # the grid is centered in the tool, with the toolbar centered under it
    top = pg.evaluate("() => document.querySelector('.pl-cfg').getBoundingClientRect().top - document.querySelector('.pl-frame').getBoundingClientRect().top")
    assert abs(top) < 1.5                                                # the sidebar's top edge meets the top edge of the grid
    steps = pg.evaluate("() => { const s = document.querySelector('.pl-movesbox'), g = document.querySelector('.pl-svg').getBoundingClientRect(), f = document.querySelector('.pl-frame').getBoundingClientRect(), r = s.getBoundingClientRect(); return [!!s.closest('.pl-left'), r.right <= g.left, Math.abs(r.top - f.top) < 1.5, s.offsetParent !== null, s.innerText.includes('Each move is listed here')]; }")
    assert steps == [True, True, True, True, True]                       # the Steps panel is out in the left sidebar from the start, level with the top of the grid, with a note until there is a move
    pg.get_by_role("button", name="Paper", exact=True).click()
    guide = pg.evaluate("() => [!!document.querySelector('.pl-hint').closest('.pl-left'), !!document.querySelector('.pl-status').closest('.pl-left')]")
    assert guide == [True, True]                                   # the hint and the status are steps text: they live in the Steps card, not under the grid
    card = pg.evaluate("() => { const p = document.querySelector('.pl-pbar'), g = document.querySelector('.pl-svg').getBoundingClientRect(), r = p.getBoundingClientRect(), s = document.querySelector('.pl-movesbox').getBoundingClientRect(), l = document.querySelector('.pl-left').getBoundingClientRect(), f = document.querySelector('.pl-frame').getBoundingClientRect(); return [!!p.closest('.pl-left'), r.right <= g.left, r.bottom <= s.top + 1, p.offsetParent !== null, Math.abs(r.top - f.top) < 1.5, l.height <= f.height + 2]; }")
    assert card == [True, True, True, True, True, True]                  # the paper tools are a card in the left sidebar above Steps, level with the top of the grid; the column is no taller than the grid
    pg.close()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))

def test_settings_menu_stays_beside_the_gear_when_the_grid_changes(grid):
    pg = grid.pg
    gear = pg.locator("button[data-key=settings]")
    gear.click()
    gap = "() => document.querySelector('.pl-cfg').getBoundingClientRect().top - document.querySelector('button[data-key=settings]').getBoundingClientRect().top"
    before = pg.evaluate(gap)
    row = pg.locator("[aria-label='Grid size']")
    for key, val in (("x0", "0"), ("x1", "20"), ("y0", "0"), ("y1", "4")):   # a much shorter grid
        row.locator(f"input[data-cfg={key}]").fill(val)
    row.get_by_role("button", name="Set grid", exact=True).click()
    assert abs(pg.evaluate(gap) - before) < 1

def test_keys_the_tool_uses_do_not_reach_the_host_but_the_rest_do(grid):
    pg = grid.pg
    pg.evaluate("() => { window.__keys = []; document.addEventListener('keydown', e => window.__keys.push(e.key)); }")   # a host (slide deck) listens on the document
    keys = lambda: pg.evaluate("() => window.__keys.splice(0)")
    grid.click(1, 1); pg.keyboard.press("ArrowRight")
    assert keys() == ["ArrowRight"]                                              # focus left on the grid by a mouse click must not trap the presenter
    pg.locator("button[data-key=line]").focus(); pg.keyboard.press("Space")
    assert keys() == []                                                          # Space presses the button, it does not turn the slide
    pg.keyboard.press("ArrowRight")
    assert keys() == ["ArrowRight"]                                              # an arrow on a button is not the tool's: the host still advances
    pg.locator("button[data-key=settings]").click(); pg.keyboard.press("ArrowRight")
    assert keys() == []                                                          # typing in a grid-size box keeps its keys
    pg.keyboard.press("Escape"); pg.locator(".pl-svg").focus(); pg.keyboard.press("Shift+Tab"); pg.keyboard.press("Tab")
    keys(); pg.keyboard.press("ArrowRight")
    assert keys() == []                                                          # keyboard focus on the grid: arrows move its cursor
    grid.click(2, 2); pg.keyboard.press("ArrowRight")
    assert keys() == ["ArrowRight"]                                              # a click on a keyboard-focused grid hands the keys back to the host
    pg.keyboard.press("Shift+Tab"); pg.keyboard.press("Tab"); keys(); pg.keyboard.press("Escape"); keys(); pg.keyboard.press("ArrowRight")
    assert keys() == ["ArrowRight"]                                              # and Escape releases the cursor


def test_check_accepts_any_one_of_several_targets(browser, site):
    pg = browser.new_page(viewport={"width": 900, "height": 1000})
    pg.goto(site + "/raw.html?p=chk2"); pg.wait_for_selector("svg.pl-svg")
    g = Grid(pg); _flip_marks_over_the_y_axis(g)
    pg.get_by_role("button", name="Check").click()
    assert g.status() == "Matches."                          # still on the second target
    g.tool("Flip"); g.click(0, 2, dx=2)
    pg.get_by_role("button", name="Check").click()
    assert g.status() == "Matches."                          # now on the first
    pg.close()
