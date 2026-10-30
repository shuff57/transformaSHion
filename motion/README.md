# transformaSHion motion studies

Three standalone animated SVGs of the wordmark. In all three, the **SH** leaves the name, slides,
turns half around, flips, and settles back into place while the rest of the word stays put.

Open `index.html` for the preview sheet, or open any `.svg` directly.

## The shared storyboard

| Beat | Loop position | What happens |
|---|---|---|
| slide | 7-20% | The SH lifts off the baseline and travels up and to the right. |
| turn | 23-37% | It turns 180° about its own center. |
| flip | 37-47% | It flips face down over a vertical mirror line. |
| home | 47-66% | It slides back into the word, finishing the turn. |
| flip back | 66-76% | It flips face up exactly in its place. |
| rest | 76-100%, 0-7% | The wordmark sits still. |

The loop is 7.2 seconds. The rest at either end means the wordmark is readable for most of the cycle.

## The three files

| File | Treatment |
|---|---|
| `transformashion-paper.svg` | A sheet of tracing paper carries the SH; the grid stays behind and the empty slot is drawn in dashes. Light and dark. |
| `transformashion-moves.svg` | The slide, turn and flip are annotated with a vector, an arc and a mirror line, plus a caption. Dark by design. |
| `transformashion-shadow.svg` | No paper or labels: a cast shadow and two trailing copies carry the move; an accent rule draws itself on landing. Light and dark. |

## Using one

Every file is self-contained: styles, tokens and animation live inside it. The simplest use is an
image, which keeps its CSS from colliding with the host page.

```html
<img src="motion/transformashion-paper.svg" alt="The letters SH slide out of transformaSHion, turn, flip and return.">
```

To let a page's CSS reach the artwork, paste the SVG inline instead. Element IDs and paint servers
are prefixed (`tp-`, `mv-`, `sh-`), but the class and keyframe names are not. If you inline more than
one study on a page, scope each file's style block, or keep them as separate images.

The two light studies follow `prefers-color-scheme`. All three stop animating and show the finished
wordmark under `prefers-reduced-motion: reduce`.

## In the site header

`plotter.html` carries a compact, inline version of the tracing-paper study at the top of the page.
It plays one cycle when the page loads, loops while the pointer is over the wordmark, and settles
back to the finished wordmark when the pointer leaves. Under reduced motion it shows the still
wordmark and never starts.
