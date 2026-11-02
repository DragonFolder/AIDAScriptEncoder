# AIDAScriptEncoder

A small web page that turns text into **AIDAScript**, a constructed writing system made of straight strokes, and lets you download the result as an **SVG** or **PNG** image.

Type into the text box and the drawing updates as you type.

## Features

- **Live preview** of the text as AIDAScript, drawn as vector graphics
- **Download** the drawing as an SVG or a PNG
- **Zoom** the preview in and out (25%–400%) without changing the downloaded size
- **Automatic wrapping**: long lines continue in a new column, with words kept whole
- **Advanced settings** (hidden by default): padding, line size, line spacing, maximum column height, line color and background color
- Dark interface with teal accents, built with [Bootstrap 5](https://getbootstrap.com/)

## Getting started

There is nothing to install or build. It's plain HTML, CSS and JavaScript.

1. Clone or download this repository.
2. Open `index.html` in a web browser.

The page loads Bootstrap from a CDN, so it needs an internet connection to be styled. Without one it still works, but looks plain.

## How AIDAScript works

### Columns

Each line of text becomes a **column**, read from **top to bottom**. Columns are placed from left to right.

### Letters

Every letter is **two strokes** going out from the letter's middle point. Each stroke points in one of eight directions:

```
NW  N  NE
  \ | /
W — · — E
  / | \
SW  S  SE
```

Upper and lower case look the same.

| Letter | Strokes | Letter | Strokes | Letter | Strokes | Letter | Strokes |
|---|---|---|---|---|---|---|---|
| a | SW, S | h | W, SW | o | NW, W | t | N, NW |
| b | W, S | i | NW, SW | p | N, W | u | NW, NE |
| c | NW, S | j | N, E | q | NE, W | v | N, SE |
| d | N, S | k | N, SW | r | E, W | w | E, NE |
| e | NE, S | l | NE, SW | s | SE, W | x | NE, SE |
| f | E, S | m | E, SW | | | y | NW, E |
| g | SE, S | n | SE, SW | | | z | SE, E |

### Punctuation

Punctuation marks are small, half-size shapes that stand apart from the letters and never touch them.

| Mark | Shape |
|---|---|
| `.` | `+` |
| `,` | `/` |
| `'` | `—` |
| `"` | `=` |
| `?` | a hook: top bar, diagonal to the middle, then down |
| `!` | `‡` |

### Spacing rules

Letters are stacked so their strokes connect naturally, without crossing in the wrong places:

- A letter moves **half a step** down from the previous one when their strokes wouldn't touch, and a **full step** otherwise.
- Strokes from different letters may **meet at their tips**, and may **cross exactly at their middles** (an X shape). Any other crossing or overlap pushes the letter further down.
- When a letter's **S** stroke lies exactly on the next letter's **N** stroke, a short extra line is drawn beside them to show the overlap. It goes on the right, moves to the left if the right is crossed, and becomes a diagonal if both sides are.
- When three letters would end up spaced unevenly (half a step, then a big jump), they're spaced a full step apart instead.
- A **space** leaves exactly one step of empty space between words.
- **Punctuation** has half a step of empty space above and below it.

## Advanced settings

| Setting | Default | What it does |
|---|---|---|
| Padding | 30 px | Space around the drawing, on all sides |
| Line size | 20 px | Length of one full stroke, which sets the size of everything |
| Line spacing | 10 px | Extra gap between two columns |
| Maximum height | 400 px | How far down a column may reach before the text wraps into a new column |
| Line color | black | Color of the strokes |
| Background color | white | Background of the drawing, also used in downloads |

## Project structure

| File | Contents |
|---|---|
| `index.html` | The page layout, styling and settings panel |
| `index.js` | Everything else, in sections: settings, letter shapes, spacing rules, layout and wrapping, drawing, rendering, zoom, and downloads |

To change how a letter looks, edit the `LETTERS` table in `index.js`. For punctuation, edit the `PUNCTUATION` table.

## Known limitations

- Digits and symbols without a defined shape (`0`–`9`, `-`, `:`, `;`, …) are drawn as a small dot.
- A single word taller than the maximum height can't be wrapped, so it runs past the limit.
- The stroke width is fixed at 5 px, so very small or very large line sizes can look too thick or too thin.
