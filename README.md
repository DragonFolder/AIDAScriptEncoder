# AIDAScriptEncoder

A small web page that turns text into **AIDAScript**, a constructed writing system made of straight strokes, and lets you download the result as an **SVG** or **PNG** image.

**Try it here: https://dragonfolder.github.io/AIDAScriptEncoder/**

Type into the text box and the drawing updates as you type. There's nothing to install.

## Features

- Live preview, with zoom (25%–400%)
- Download as SVG or PNG
- Long lines wrap into new columns, keeping words whole
- Advanced settings for size, spacing, colors and layout
- An experimental **compact** layout that packs the text into a tight, round or square blob

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

| Letter | Strokes | Letter | Strokes | Letter | Strokes | Letter | Strokes |
|---|---|---|---|---|---|---|---|
| a | SW, S | h | W, SW | o | NW, W | t | N, NW |
| b | W, S | i | NW, SW | p | N, W | u | NW, NE |
| c | NW, S | j | N, E | q | NE, W | v | N, SE |
| d | N, S | k | N, SW | r | E, W | w | E, NE |
| e | NE, S | l | NE, SW | s | SE, W | x | NE, SE |
| f | E, S | m | E, SW | | | y | NW, E |
| g | SE, S | n | SE, SW | | | z | SE, E |

Letters are stacked so their strokes connect without crossing in the wrong places. Words are separated by a gap.

Punctuation marks are small shapes that stand apart and never touch anything:

| Mark | `.` | `,` | `'` | `"` | `?` | `!` |
|---|---|---|---|---|---|---|
| Shape | `+` | `/` | `—` | `=` | hook | `‡` |

## Advanced settings

| Setting | Default | What it does |
|---|---|---|
| Padding | 30 px | Space around the drawing |
| Line size | 20 px | Length of one stroke; sets the size of everything |
| Line spacing | 10 px | Gap between columns (rectangle only) |
| Maximum height | 400 px | How tall a column may get before wrapping (rectangle only) |
| Shape | Rectangle | **Rectangle**: plain columns. **Compact** (experimental): packs the text as tightly as possible, with overlapping columns that never touch |
| Guide shape | Circle | Compact only: aim for a round or a square result |
| Extend free line ends | on | Compact only: lengthens strokes whose tips touch nothing (and either end of the N/S overlap marker), to fill empty space |
| Show line guides | off | Compact only: shows where each column runs (preview only) |
| Line / background color | black / white | Colors of the drawing |

## Project structure

| File | Contents |
|---|---|
| `index.html` | Page layout and settings panel |
| `index.css` | Styling (teal accent on top of Bootstrap) |
| `index.js` | Everything else; the sections are listed at the top of the file |

To change how a letter looks, edit the `LETTERS` table in `index.js`; for punctuation, the `PUNCTUATION` table.

## Known limitations

- Digits and other symbols (`0`–`9`, `-`, `:`, …) are drawn as a small dot.
- In the rectangle shape, a single word taller than the maximum height runs past it.
- The stroke width is fixed at 5 px.
- The compact shape is slower with long text (a few hundred milliseconds for about 600 characters).
