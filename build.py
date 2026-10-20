#!/usr/bin/env python3
"""Build the release files into dist/.

    python3 build.py

  dist/tracing-paper.html        one self-contained file: open it, host it, or email it
  dist/tracing-paper.js, .css    the core, for embedding in your own page
  dist/bookshelf/tracing-paper.js, .css
                                 the same core plus the example presets and the bookSHelf page-plugin wrapper
                                 (the plugin loader expects <name>/<name>.js and <name>.css)
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SRC, DIST = ROOT / "src", ROOT / "dist"


def read(name):
    return (SRC / name).read_text(encoding="utf-8")


def main():
    css, core, presets, plugin = read("tracing-paper.css"), read("tracing-paper.js"), read("presets.js"), read("bookshelf-plugin.js")
    (DIST / "bookshelf").mkdir(parents=True, exist_ok=True)
    (DIST / "tracing-paper.js").write_text(core, encoding="utf-8")
    (DIST / "tracing-paper.css").write_text(css, encoding="utf-8")
    (DIST / "bookshelf" / "tracing-paper.js").write_text(presets + "\n" + core + "\n" + plugin, encoding="utf-8")
    (DIST / "bookshelf" / "tracing-paper.css").write_text(css, encoding="utf-8")
    page = read_index()
    page = page.replace('<link rel="stylesheet" href="src/tracing-paper.css">', "<style>\n" + css + "</style>")
    page = page.replace('<script src="src/presets.js"></script>', "<script>\n" + presets + "</script>")
    page = page.replace('<script src="src/tracing-paper.js"></script>', "<script>\n" + core + "</script>")
    assert 'src="src/' not in page and 'href="src/' not in page, "a src/ reference survived"
    (DIST / "tracing-paper.html").write_text(page, encoding="utf-8")
    print("wrote", ", ".join(str(p.relative_to(ROOT)) for p in sorted(DIST.rglob("*")) if p.is_file()))


def read_index():
    return (ROOT / "index.html").read_text(encoding="utf-8")


if __name__ == "__main__":
    main()
