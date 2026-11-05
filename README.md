# AIDAScriptEncoder

A small web page that turns text into **AIDAScript**, a constructed writing system made of straight strokes, and lets you download the result as an **SVG** or **PNG** image.

**Try it here: https://dragonfolder.github.io/AIDAScriptEncoder/**

Type into the text box and the drawing updates as you type. There's nothing to install.

## Features

- Live preview, with zoom (25%–400%): point at a letter (or tap it) to see what it says
- The text is kept inside the downloads: as the SVG's title, and as the PNG's description
- Download as SVG or PNG, or copy the image to paste it anywhere
- **Copy link**: a link that opens exactly this drawing (text, settings and layout)
- Your settings are remembered in your browser for next time (**Reset to defaults** clears them)
- Long lines wrap into new columns, keeping words whole
- Settings for size, spacing, colors and layout
- **How to read AIDAScript**, at the bottom of the page: every letter, digit and punctuation mark (click a letter or digit to type it)
- A **compact** layout that packs the text into a tight blob, guided by a shape of your choice
- **Read a picture** (experimental): turns a picture of AIDAScript back into text: a download from here, a screenshot of one, or one someone sent you. Choose it, drop it or paste it (Ctrl+V). For now it reads the rectangle shape, in any size and colors

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

*(Drawn from the `LETTERS` table by `tools/make-letter-images.js`, like the digits and punctuation below.)*

Letters are stacked so their strokes connect without crossing in the wrong places. Words are separated by a gap.

Digits are **one stroke**, pointing from the middle to where the digit sits on a phone keypad. **2** and **8**, which lie on the middle line, get a bar across their middle end (2 is ⊥, 8 is T); **5**, the middle key, is a **+**, and **0**, below the keypad, is a diamond. Most digits are told apart by which side of the middle line they're on (4 is left of it, 6 right of it), so a number made only of 1, 4 and 7, or only of 3, 6 and 9, gets a short line along the middle to show where it is.

Digits stand apart from letters and punctuation. Within a number, each digit goes half a step below the one before it, and further down, half a step at a time, while:
- two lines would meet other than in an X at both their middles, with one line's tip on the other's middle, or tip to tip at least a full step apart (and not in a straight line);
- in a number with a middle line, two lines would cross less than a full step apart (that closes a tiny triangle against the middle line, as in 41);
- a line would touch the 0's diamond anywhere but a corner.

```
1  2  3        1 = NW   2 = N   3 = NE
 \ | /         4 = W    5 = +   6 = E
4 —+— 6        7 = SW   8 = S   9 = SE
 / | \         0 = ◇
7  8  9
   0
```

| **1** | **2** | **3** | **4** | **5** | **6** | **7** | **8** | **9** | **0** |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| ![1](images/digits/1.svg) | ![2](images/digits/2.svg) | ![3](images/digits/3.svg) | ![4](images/digits/4.svg) | ![5](images/digits/5.svg) | ![6](images/digits/6.svg) | ![7](images/digits/7.svg) | ![8](images/digits/8.svg) | ![9](images/digits/9.svg) | ![0](images/digits/0.svg) |

Punctuation marks are small shapes that stand apart and never touch anything. Quote marks open with **Λ** and close with **V**, and `"` is two of them, one above the other. An apostrophe inside a word (don't) is always Λ, as is a `'` that's never closed (the dogs'). Curly quotes (‘ ’ “ ”) work too. Parentheses open with a cap (⊓) and close with a cup (⊔); brackets `[ ]` and braces `{ }` draw the same way, and guillemets `« »` `‹ ›` draw as quote marks. Dashes (– —) draw as `-`, and `…` as `...`. Two quote marks in a row get an extra half line size between them, so '' doesn't read as ". The colon's two dots sit side by side, so it never looks like periods in a row.

| `.` | `,` | `'` (apostrophe, opening) | `'` (closing) | `"` (opening) | `"` (closing) | `?` | `!` |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| ![period](images/punctuation/period.svg) | ![comma](images/punctuation/comma.svg) | ![apostrophe](images/punctuation/apostrophe.svg) | ![closing single quote](images/punctuation/closing-single-quote.svg) | ![opening quote](images/punctuation/opening-quote.svg) | ![closing quote](images/punctuation/closing-quote.svg) | ![question](images/punctuation/question.svg) | ![exclamation](images/punctuation/exclamation.svg) |

| `-` (also – —) | `:` | `;` | `(` | `)` | `/` |
|:---:|:---:|:---:|:---:|:---:|:---:|
| ![hyphen](images/punctuation/hyphen.svg) | ![colon](images/punctuation/colon.svg) | ![semicolon](images/punctuation/semicolon.svg) | ![opening parenthesis](images/punctuation/opening-parenthesis.svg) | ![closing parenthesis](images/punctuation/closing-parenthesis.svg) | ![slash](images/punctuation/slash.svg) |

## Settings

| Setting | Default | What it does |
|---|---|---|
| Padding | 30 px | Space around the drawing |
| Line size | 20 px | Length of one stroke; sets the size of everything |
| Line spacing | 10 px | Gap between columns (rectangle only) |
| Maximum height | 400 px | How tall a column may get before wrapping (rectangle only) |
| Shape | Rectangle | **Rectangle**: plain columns. **Compact**: packs the text as tightly as possible, with overlapping columns that never touch |
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

## Reading a picture

**Read a picture** reads a picture of AIDAScript in the rectangle shape back into text. It doesn't need the settings the picture was made with: it finds the line size, the columns and their tops in the picture itself, so it also reads screenshots, smaller or bigger copies, other colors and see-through backgrounds. It reads hand-made pictures too (drawn in Inkscape, say), as long as they're drawn the way the page draws them. Anything else in the picture, like a drawing beside the text, is left out: it's drawn with a different line width, or doesn't read as AIDAScript.

It doesn't undo the spacing rules. It lets the encoder do the placing: a column is read from the top down, and at each step every character is tried after the ones read so far, put exactly where the encoder would put it, and kept only if all of its lines lie on ink. Once a stretch of the column is out of reach of anything still to come, all of its ink must be explained. A column is read when all of its ink is. So whatever the encoder can tell apart, the reader can too, and a new spacing rule needs no change in `decode.js`.

Before reading, the picture's ink is told from its background by how different each pixel's color is. Lines with a glow, a shadow or soft edges are cut down to their cores.

Older pictures are read too, in up to three ways, each only for the columns the ways before couldn't read:
1. as the page draws today;
2. with the punctuation marks as they were drawn before November 2026: `+` for a period, `/` for a comma, `—` for an apostrophe, `=` for a quote mark, `‡` for an exclamation mark. A picture that reads with a 5 right after a word (the old period read as today's 5) is read this way throughout;
3. loosely, for older versions with other spacing rules and for other encoders: each character may sit anywhere at least half a step below the one before, an extra line beside a stroke may mark an overlap, and words end where the picture's gaps (or steps) are bigger than usual. This can get a letter or a space wrong, and takes longer: up to half a minute for a picture that doesn't read in full.

What it can't know:
- Whether a column ended because the text had a line break or because the line was too long. It guesses: a line break if the next column's first word would have fit.
- A space between two punctuation marks can draw the same as none (`’ “` and `’“`). It then keeps the space.
- Letters are read in lower case.
- A mark it doesn't know (a symbol from another encoder, say) stops the column there: the text then ends in "…".

## Project structure

| File | Contents |
|---|---|
| `index.html` | Page layout and settings panel |
| `index.css` | Styling (teal accent on top of Bootstrap) |
| `layout.js` | Where every character goes: letter shapes, spacing rules, and both layouts |
| `layout-worker.js` | Runs the compact layout in the background, so the page never freezes |
| `decode.js` | Reading a picture back into text (see [Reading a picture](#reading-a-picture)) |
| `decode-worker.js` | Reads a picture in the background |
| `colors.js` | The Random colors generator |
| `index.js` | The page: settings, drawing, preview, downloads, sharing, the alphabet |
| `tests/` | The tests (see [Testing](#testing)) |
| `images/` | The logo, the tab icon (`favicon.svg`), the picture shown when a link is shared (`social-preview.png`), and the letter, digit and punctuation pictures in this README |
| `tools/make-letter-images.js` | Redraws those pictures (`node tools/make-letter-images.js`) |

To change how a letter looks, edit the `LETTERS` table in `layout.js`; for digits, the `DIGITS` table; for punctuation (and the digits 0 and 5), the `PUNCTUATION` table. Then run `node tools/make-letter-images.js` to redraw the pictures above.

## Testing

Two sets of checks, worth running before merging into `main`:

- **`node tests/run-tests.js`** (about 5 seconds, needs [Node.js](https://nodejs.org/), nothing else): the layouts are the same as before (`tests/snapshots.json`), lines of different columns never touch, no guide shape makes the layout freeze, the guide shapes' sums agree, random colors stay readable, and the decoder reads back what was drawn (in several sizes, with columns apart and touching).
  - `--full` also tries every Surprise me combination (a few minutes).
  - `--update` saves the current layouts as the expected ones. Use it after changing the layout on purpose, once you've checked the result in the page.
- **`tests/browser.html`**: open it through a local server (for example `python -m http.server` in the project folder, then `http://localhost:8000/tests/browser.html`) and press **Run the tests**. It clicks through the real page: drawing, the background worker, the frames, Random colors, Surprise me, Reset and Read a picture (including a hand-made picture from `tests/decoder_tests`). Nothing is downloaded.

## Known limitations

- Symbols other than the punctuation above (`#`, `%`, `&`, emoji, …) have no shape yet, and are drawn as a space, so `50%` doesn't run into the next word. Accented letters are drawn without their accents (é as e).
- A word whose picture is the same when flipped left to right looks exactly like its mirror word, unless something else in the column shows where the middle is: `ho` and `zw` (also `hio` and `zxw`). These are the only ones among all letter combinations up to four letters, and only "ho" is a word. The letters follow flag semaphore, so they're kept as they are.
- In the rectangle shape, a single word taller than the maximum height runs past it.
- The stroke width is fixed at 5 px.
- **Read a picture** reads the rectangle shape only (not the compact shape or frames), and only pictures that are upright and not stretched. A long text can take several seconds. Columns that touch each other (Line spacing less than the line width) are harder: they often read, but not always.
- The compact shape takes a moment with long text (about a second for 600 characters). The page stays usable meanwhile, showing "Arranging…". Opened straight from a file, some browsers don't allow the background worker, and the page then pauses instead.
