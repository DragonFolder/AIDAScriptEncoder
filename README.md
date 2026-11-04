# AIDAScriptEncoder

A small web page that turns text into **AIDAScript**, a constructed writing system made of straight strokes, and lets you download the result as an **SVG** or **PNG** image.

**Try it here: https://dragonfolder.github.io/AIDAScriptEncoder/**

Type into the text box and the drawing updates as you type. There's nothing to install.

## Features

- Live preview, with zoom (25%–400%)
- Download as SVG or PNG
- Long lines wrap into new columns, keeping words whole
- Settings for size, spacing, colors and layout
- An experimental **compact** layout that packs the text into a tight blob, guided by a shape of your choice

## How AIDAScript works

Each line of text becomes a **column**, read from top to bottom. Columns go from left to right.

Every letter is **two strokes** going out from its middle point, each in one of eight directions. Upper and lower case look the same.

```
NW  N  NE
  \ | /
W — · — E
  / | \
SW  S  SE
```

| **a** | **b** | **c** | **d** | **e** | **f** | **g** |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| ![a](images/letters/a.svg) | ![b](images/letters/b.svg) | ![c](images/letters/c.svg) | ![d](images/letters/d.svg) | ![e](images/letters/e.svg) | ![f](images/letters/f.svg) | ![g](images/letters/g.svg) |

| **h** | **i** | **j** | **k** | **l** | **m** | **n** |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| ![h](images/letters/h.svg) | ![i](images/letters/i.svg) | ![j](images/letters/j.svg) | ![k](images/letters/k.svg) | ![l](images/letters/l.svg) | ![m](images/letters/m.svg) | ![n](images/letters/n.svg) |

| **o** | **p** | **q** | **r** | **s** | **t** | **u** |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| ![o](images/letters/o.svg) | ![p](images/letters/p.svg) | ![q](images/letters/q.svg) | ![r](images/letters/r.svg) | ![s](images/letters/s.svg) | ![t](images/letters/t.svg) | ![u](images/letters/u.svg) |

| **v** | **w** | **x** | **y** | **z** |
|:---:|:---:|:---:|:---:|:---:|
| ![v](images/letters/v.svg) | ![w](images/letters/w.svg) | ![x](images/letters/x.svg) | ![y](images/letters/y.svg) | ![z](images/letters/z.svg) |

*(Drawn from the `LETTERS` table by `tools/make-letter-images.js`.)*

Letters are stacked so their strokes connect without crossing in the wrong places. Words are separated by a gap.

Punctuation marks are small shapes that stand apart and never touch anything:

| Mark | `.` | `,` | `'` | `"` | `?` | `!` |
|---|---|---|---|---|---|---|
| Shape | `+` | `/` | `—` | `=` | hook | `‡` |

## Settings

| Setting | Default | What it does |
|---|---|---|
| Padding | 30 px | Space around the drawing |
| Line size | 20 px | Length of one stroke; sets the size of everything |
| Line spacing | 10 px | Gap between columns (rectangle only) |
| Maximum height | 400 px | How tall a column may get before wrapping (rectangle only) |
| Shape | Rectangle | **Rectangle**: plain columns. **Compact** (experimental): packs the text as tightly as possible, with overlapping columns that never touch |
| Guide shape | Circle | Compact only: the shape to aim for: circle, rectangle, hexagon, diamond or triangle |
| Width : height | 1 : 1 | Compact only: stretches the guide shape (a circle becomes an oval, the rectangle starts out square) |
| Rotation | 0° | Compact only: turns the guide shape, up to 180° |
| Fit to guide | Tightest | Compact only: from the tightest result to one that fills out the guide shape more closely |
| Extend free line ends | on | Compact only: lengthens strokes whose tips touch nothing (and either end of the N/S overlap marker), to fill empty space |
| Frame | None | Compact only: a border around the result: the **guide shape**, the **smallest rectangle**, or a **blob** (the tightest outline without dents, with rounded corners). Only the guide shape affects the layout |
| Frame color | same as line color | Compact only: the frame's color; untick **Same as line color** to pick a different one |
| Frame thickness | 5 px | Compact only: how thick the frame is drawn (the lines stay 5 px) |
| Show line guides | off | Compact only: shows where each column runs (preview only) |
| Transparent | off | No background: the downloaded PNG and SVG are see-through (the preview shows a checkerboard) |
| Line / background color | black / white | Colors of the drawing. **🎲 Random colors** picks line, second line, frame and background colors that go together (a random color-wheel harmony, mood and background style, always with clear contrast; the name of the combination shows next to the button); it leaves **Same as line color** as it is |
| Column colors | One color | Compact only: give every column the line color, or alternate it with the **second line color**, so overlapping columns are easy to tell apart |

**🎲 Surprise me**, above the preview, switches to the compact shape with a random guide shape, stretch, rotation, frame and colors, and shows a random one of the layouts found (the text and sizes stay as they are).

In the compact shape, the **‹ Layout 1 / N ›** buttons above the preview step through the best few different layouts for the same text.

## Project structure

| File | Contents |
|---|---|
| `index.html` | Page layout and settings panel |
| `index.css` | Styling (teal accent on top of Bootstrap) |
| `layout.js` | Where every character goes: letter shapes, spacing rules, and both layouts |
| `layout-worker.js` | Runs the compact layout in the background, so the page never freezes |
| `index.js` | The page: settings, drawing, preview, downloads |
| `images/letters/` | The letter pictures in this README |
| `tools/make-letter-images.js` | Redraws those pictures (`node tools/make-letter-images.js`) |

To change how a letter looks, edit the `LETTERS` table in `layout.js` (then run `node tools/make-letter-images.js` to redraw the pictures above); for punctuation, the `PUNCTUATION` table.

## Known limitations

- Digits and other symbols (`0`–`9`, `-`, `:`, …) are drawn as a small dot.
- In the rectangle shape, a single word taller than the maximum height runs past it.
- The stroke width is fixed at 5 px.
- The compact shape takes a moment with long text (about a second for 600 characters). The page stays usable meanwhile, showing "Arranging…". Opened straight from a file, some browsers don't allow the background worker, and the page then pauses instead.
