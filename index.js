// =============================================================================
// AIDAScript: turns the text in the textarea into an SVG drawing.
//
// Each line of text is drawn as a column, from top to bottom.
// Every letter is two strokes going out from its middle point, and letters are
// stacked so their strokes connect without crossing in the wrong places.
//
// Contents:
//   1. Settings
//   2. Shapes          – what each character looks like
//   3. Spacing rules   – how far below the previous character each one goes
//   4. Layout          – placing a whole line, and wrapping long lines
//   5. Compact layout  – the experimental compact shape
//   6. Drawing         – turning shapes into SVG lines
//   7. Render          – runs on every keystroke
//      Zoom            – preview zoom buttons
//   8. Downloads       – SVG and PNG buttons
//
// Units: the shape and spacing code works in "lineSizes" (1 = the length of one
// full stroke). The compact layout and the drawing code work in pixels.
// =============================================================================


// =============================================================================
// 1. Settings
// =============================================================================

// Defaults. The "Settings" panel overwrites them before every render (see readSettings).
const CONFIG = {
  lineSize: 20,          // length of one full stroke, in pixels
  lineSpacing: 10,       // extra gap between two columns of text, in pixels (rectangle only)
  maxLineLength: 400,    // how far down a column may reach (from the top padding) before wrapping, in pixels (rectangle only)
  padding: { top: 30, right: 30, bottom: 30, left: 30 },
  stroke: { color: '#000000', width: 5 },
  background: '#ffffff',
  shape: 'rectangle',    // 'rectangle' or 'compact'
  guideShape: 'circle',  // compact only: 'circle' or 'square', the outline that guides how tall each column may be
  showGuide: false,      // compact only: string each column's characters on a line in the preview (never downloaded)
  extendEnds: true,      // compact only: draw letter strokes whose tips touch nothing half a lineSize longer (see extendFreeEnds)
  columnColours: 'single',  // compact only: 'single' (all in stroke.color) or 'alternate' (stroke.color and
                            // secondColor in turn, column by column)
  secondColor: '#1971c2',   // compact only: the other colour for 'alternate'
  frame: 'none',         // compact only: 'none', 'guide', 'rectangle' or 'blob': a frame around the result (see frameAround)
  frameColor: '#000000', // compact only: the frame's colour (stroke.color instead when frameSameColor)
  frameSameColor: true,
  frameWidth: 5,         // compact only: the frame's thickness, in pixels
};

const byId = id => document.getElementById(id);

// Copy the values from the "Settings" panel into CONFIG.
// An empty or invalid number keeps the last valid value.
function readSettings(){
  const number = (id, min, current) => {
    const n = parseFloat(byId(id).value);
    return Number.isFinite(n) && n >= min ? n : current;
  };

  const padding = number('setPadding', 0, CONFIG.padding.top);
  CONFIG.padding = { top: padding, right: padding, bottom: padding, left: padding };
  CONFIG.lineSize = number('setLineSize', 1, CONFIG.lineSize);
  CONFIG.lineSpacing = number('setLineSpacing', 0, CONFIG.lineSpacing);
  CONFIG.maxLineLength = number('setMaxHeight', 1, CONFIG.maxLineLength);
  CONFIG.stroke.color = byId('setLineColor').value;
  CONFIG.background = byId('setBgColor').value;
  CONFIG.shape = byId('setShape').value;
  CONFIG.guideShape = byId('setGuideShape').value;
  CONFIG.showGuide = byId('setShowGuide').checked;
  CONFIG.extendEnds = byId('setExtendEnds').checked;
  CONFIG.columnColours = byId('setColumnColours').value;
  CONFIG.secondColor = byId('setSecondColor').value;
  CONFIG.frame = byId('setFrame').value;
  CONFIG.frameColor = byId('setFrameColor').value;
  CONFIG.frameSameColor = byId('setFrameSameColor').checked;
  CONFIG.frameWidth = number('setFrameWidth', 1, CONFIG.frameWidth);

  // Only show the settings that matter for the current choices (each with its label)
  const show = (id, visible) =>
    byId(id).closest('[data-setting]').classList.toggle('d-none', !visible);
  const compact = CONFIG.shape == 'compact';
  const framed = compact && CONFIG.frame != 'none';
  show('setMaxHeight', !compact);
  show('setLineSpacing', !compact);   // compact columns overlap instead
  show('setGuideShape', compact);
  show('compactOptions', compact);    // extend free line ends, show line guides
  show('setColumnColours', compact);
  show('setSecondColor', compact && CONFIG.columnColours == 'alternate');
  show('setFrame', compact);
  show('frameColorPanel', framed);
  show('setFrameWidth', framed);
  byId('setFrameColor').classList.toggle('d-none', CONFIG.frameSameColor);
  byId('compactBadge').hidden = !compact;
  byId('layoutPicker').hidden = !compact;

  // The Frame tab only for the compact shape (leaving it if it was open)
  byId('frameTab').classList.toggle('d-none', !compact);
  if (!compact && settingsTab == 'frame') showSettingsTab('shape');
}

// The settings are split into tabs (Size, Shape, Colors, Frame), showing one group at a time
let settingsTab = 'size';
function showSettingsTab(name){
  settingsTab = name;
  document.querySelectorAll('[data-tab]').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab == name);
    tab.setAttribute('aria-selected', tab.dataset.tab == name);
  });
  document.querySelectorAll('[data-pane]').forEach(pane => pane.classList.toggle('d-none', pane.dataset.pane != name));
}
document.querySelectorAll('[data-tab]').forEach(tab => tab.onclick = () => showSettingsTab(tab.dataset.tab));

// "Random colors": a line color, second line color, frame color and background that go together,
// made from three choices, each picked at random:
// - a harmony (COLOR_HARMONIES): which hues the line, the second line and the frame take, around
//   a random base hue on the color wheel;
// - a mood (COLOR_MOODS): how saturated the lines are;
// - a background (COLOR_BACKGROUNDS): light or dark, how colorful, and which hue it's tinted with.
// The lines get a strong lightness on the other side of the background from it, and everything must
// stand out clearly against the background (a contrast of at least 4.5, as for readable text), or
// it tries again. Returns { line, second, frame, background, name }, `name` saying what was picked.
const COLOR_HARMONIES = [
  // hues: [line, second line, frame], in degrees round the wheel from the base hue (one way or
  // the other, picked at random)
  { name: 'Complementary',       hues: [0, 180, 0] },
  { name: 'Split-complementary', hues: [0, 150, 210] },
  { name: 'Triadic',             hues: [0, 120, 240] },
  { name: 'Square',              hues: [0, 90, 180] },
  { name: 'Analogous',           hues: [0, 30, 60] },
  // one hue: the second line lighter or darker instead
  { name: 'Monochromatic',       hues: [0, 0, 0], monochrome: true },
  // a near-grey line color, with one vivid accent for the second line and the frame
  { name: 'Neutral + accent',    hues: [0, 0, 0], neutral: true },
];
const COLOR_MOODS = [
  { name: 'muted',    saturation: [25, 45] },
  { name: 'balanced', saturation: [50, 70] },
  { name: 'vivid',    saturation: [75, 95] },
];
const COLOR_BACKGROUNDS = [
  { name: 'light',          dark: false, saturation: [20, 45], lightness: [92, 97] },
  { name: 'pastel',         dark: false, saturation: [45, 75], lightness: [86, 91] },
  { name: 'neutral light',  dark: false, saturation: [0, 8],   lightness: [95, 99] },
  { name: 'dark',           dark: true,  saturation: [15, 35], lightness: [7, 13] },
  { name: 'deep',           dark: true,  saturation: [40, 65], lightness: [12, 19] },
  { name: 'neutral dark',   dark: true,  saturation: [0, 8],   lightness: [8, 14] },
];
function randomColors(){
  const pick = (low, high) => low + Math.random() * (high - low);
  const one = list => list[Math.floor(Math.random() * list.length)];
  const wheel = h => ((h % 360) + 360) % 360;
  // The three choices are made once; when the colors don't stand out enough, only the exact
  // shades are picked again, each time a little further from the background, so that every
  // harmony, mood and background comes up about equally often
  const harmony = one(COLOR_HARMONIES), mood = one(COLOR_MOODS), back = one(COLOR_BACKGROUNDS);
  for (let tries = 0; ; tries++) {
    const base = pick(0, 360), turn = Math.random() < 0.5 ? 1 : -1;   // (which way round the wheel)
    const [lineHue, secondHue, frameHue] = harmony.hues.map(h => wheel(base + h * turn));

    // The background: tinted with the base hue, the second line's hue, or the base's complement
    const backHue = one([lineHue, secondHue, wheel(base + 180)]);
    const background = hslToHex(backHue, pick(...back.saturation), pick(...back.lightness));

    // The lines: strong lightness on the other side of the background (further from it for the frame)
    const away = back.dark ? 1 : -1;
    const lightness = (back.dark ? pick(62, 76) : pick(24, 38)) + away * Math.min(tries, 15);
    const saturation = pick(...mood.saturation);
    let line = hslToHex(lineHue, saturation, lightness);
    let second = hslToHex(secondHue, saturation, lightness);
    let frame = hslToHex(frameHue, Math.min(saturation + 10, 95), lightness + 10 * away);
    if (harmony.monochrome) {
      // the same hue at three depths: the line deepest, the second line nearer the background
      line = hslToHex(lineHue, saturation, lightness + 8 * away);
      second = hslToHex(lineHue, saturation * 0.8, lightness - 8 * away);
      frame = hslToHex(lineHue, Math.min(saturation + 10, 95), lightness + 14 * away);
    }
    if (harmony.neutral) {
      // a warm or cool grey for the line; a vivid accent (any hue) for the second line and the frame
      const accent = wheel(base + pick(90, 270));
      line = hslToHex(lineHue, pick(4, 12), lightness + 6 * away);
      second = hslToHex(accent, pick(70, 95), lightness);
      frame = hslToHex(accent, pick(70, 95), lightness + 6 * away);
    }

    const weakest = Math.min(...[line, second, frame].map(c => contrast(c, background)));
    if (tries < 100 && weakest < 4.5) continue;
    const name = `${harmony.name} · ${harmony.neutral ? 'accent' : mood.name} · ${back.name} background`;
    return { line, second, frame, background, name };
  }
}

// A color from hue (degrees), saturation and lightness (percent, kept within 0 to 100), as '#rrggbb'
function hslToHex(h, s, l){
  s = Math.min(Math.max(s, 0), 100) / 100;
  l = Math.min(Math.max(l, 0), 100) / 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [0, 8, 4].map(n => channel(n).toString(16).padStart(2, '0')).join('');
}

// How well two colors ('#rrggbb') stand apart: from 1 (the same) to 21 (black on white), as WCAG measures it
function contrast(a, b){
  const luminance = hex => {
    const [r, g, bl] = [1, 3, 5].map(i => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

byId('randomColors').onclick = () => {
  const { line, second, frame, background, name } = randomColors();
  byId('setLineColor').value = line;
  byId('setSecondColor').value = second;
  byId('setFrameColor').value = frame;   // ("Same as line color" stays as it is)
  byId('setBgColor').value = background;
  byId('randomColorsName').textContent = name;   // what was picked, e.g. "Triadic · muted · deep background"
  render();
};

// Each setting's "?" explains it (its data-tip) in a box above it, or below it if there's no
// room above, kept on screen. Shown while pointed at or focused (tapping it focuses it).
const tipBox = document.createElement('div');
tipBox.className = 'tip-box';
tipBox.setAttribute('role', 'tooltip');
document.body.appendChild(tipBox);
function showTip(tip){
  tipBox.textContent = tip.dataset.tip;
  tipBox.style.display = 'block';
  const r = tip.getBoundingClientRect(), w = tipBox.offsetWidth, h = tipBox.offsetHeight;
  const left = Math.max(8, Math.min(r.left + r.width/2 - w/2, document.documentElement.clientWidth - w - 8));
  const top = r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6;
  tipBox.style.left = left + scrollX + 'px';
  tipBox.style.top = top + scrollY + 'px';
}
const hideTip = () => { tipBox.style.display = 'none'; };
document.querySelectorAll('.tip').forEach(tip => {
  tip.addEventListener('mouseenter', () => showTip(tip));
  tip.addEventListener('focus', () => showTip(tip));
  tip.addEventListener('mouseleave', () => { if (document.activeElement != tip) hideTip(); });
  tip.addEventListener('blur', hideTip);
  tip.addEventListener('click', e => { e.preventDefault(); tip.focus(); });   // not the label's click (it would tick a checkbox)
});

const NS = 'http://www.w3.org/2000/svg';
const input = byId('input');
const preview = byId('preview');
let svg;   // the current drawing, rebuilt by render()


// =============================================================================
// 2. Shapes
// =============================================================================

// Directions a stroke can point, as [x, y] offsets from the letter's middle.
// (y grows downward, so N is -1.)
const N  = [0, -1];
const S  = [0, 1];
const W  = [-1, 0];
const E  = [1, 0];
const NW = [-1, -1];
const NE = [1, -1];
const SW = [-1, 1];
const SE = [1, 1];

// Each letter is two strokes. Upper and lower case look the same.
const LETTERS = {
  a: [SW, S],   b: [W, S],    c: [NW, S],   d: [N, S],    e: [NE, S],   f: [E, S],    g: [SE, S],
  h: [W, SW],   i: [NW, SW],  j: [N, E],    k: [N, SW],   l: [NE, SW],  m: [E, SW],   n: [SE, SW],
  o: [NW, W],   p: [N, W],    q: [NE, W],   r: [E, W],    s: [SE, W],
  t: [N, NW],   u: [NW, NE],  v: [N, SE],   w: [E, NE],   x: [NE, SE],  y: [NW, E],   z: [SE, E],
};

// Characters with no shape (digits, symbols, ...) draw as a dot: two zero-length strokes
const NO_SHAPE = [[0, 0], [0, 0]];

// Punctuation marks: small shapes that stand alone and never touch other lines.
// They have half a lineSize of empty space above and below them.
// Each line is [x1, y1, x2, y2], in lineSizes, relative to the mark's middle.
const PUNCTUATION = {
  '.': [[0, -0.5, 0, 0.5], [-0.5, 0, 0.5, 0]],                                    // +
  ',': [[0.5, -0.5, -0.5, 0.5]],                                                  // /
  "'": [[-0.5, 0, 0.5, 0]],                                                       // —
  '"': [[-0.5, -0.25, 0.5, -0.25], [-0.5, 0.25, 0.5, 0.25]],                      // =
  '?': [[-0.5, -0.5, 0.5, -0.5], [0.5, -0.5, 0, 0], [0, 0, 0, 0.5]],              // hook: top bar, diagonal to the middle, down
  '!': [[0, -0.5, 0, 0.5], [-0.5, -0.25, 0.5, -0.25], [-0.5, 0.25, 0.5, 0.25]],   // ‡
};

function isPunctuation(ch){
  return Object.hasOwn(PUNCTUATION, ch);
}

// The two stroke directions of a character (NO_SHAPE if it isn't a letter)
function getCharShape(ch){
  const key = ch?.toLowerCase();
  return Object.hasOwn(LETTERS, key) ? LETTERS[key] : NO_SHAPE;
}

// How far above / below its middle a character reaches, in lineSizes.
// The middle point (0) is always part of a letter.
// Punctuation uses the actual height of its lines: ' is flat (0), " reaches ±0.25, the rest ±0.5.
function letterTop(ch){
  if (isPunctuation(ch)) return Math.min(...punctuationYs(ch));
  return Math.min(0, ...getCharShape(ch).map(dir => dir[1]));   // -1 if a stroke points up, else 0
}

function letterBottom(ch){
  if (isPunctuation(ch)) return Math.max(...punctuationYs(ch));
  return Math.max(0, ...getCharShape(ch).map(dir => dir[1]));   // 1 if a stroke points down, else 0
}

// Every y coordinate used by a punctuation mark's lines
function punctuationYs(ch){
  return PUNCTUATION[ch].flatMap(([x1, y1, x2, y2]) => [y1, y2]);
}


// =============================================================================
// 3. Spacing rules
//
// Positions are the y of each character's middle, in lineSizes, with 0 at the
// top padding. Each character's position depends on the ones before it.
// =============================================================================

// Do the previous letter's strokes touch the current letter's strokes,
// when the previous letter sits one lineSize above the current one?
function shapesTouch(previousShape, currentShape){
  const prev = dir => previousShape.includes(dir);
  const cur = dir => currentShape.includes(dir);

  return prev(S) ||                       // previous points straight down into current's middle
         cur(N) ||                        // current points straight up into previous's middle
         (prev(SW) && (cur(W) || cur(NW))) ||
         (prev(W) && cur(NW)) ||
         (prev(SE) && (cur(E) || cur(NE))) ||
         (prev(E) && cur(NE));
}

// Do an earlier letter's strokes cross or overlap the current letter's strokes,
// when the earlier letter sits at least 1 but less than 2 lineSizes above?
// (Tips just meeting is allowed.) At that distance only a downward stroke and an
// upward stroke on the same side can cross: SW over NW, SE over NE, or S along N.
function shapesIntersect(earlierShape, currentShape, distance){
  const earlier = dir => earlierShape.includes(dir);
  const cur = dir => currentShape.includes(dir);

  if (distance == 1) {
    // Exactly one lineSize apart, SW/NW and SE/NE form an X crossing at the middle
    // of both strokes: allowed. S and N would lie on top of each other: not allowed.
    return earlier(S) && cur(N);
  }

  // Further apart, these pairs cross off-centre (or S and N partly overlap): not allowed
  return (earlier(S) && cur(N)) ||
         (earlier(SW) && cur(NW)) ||
         (earlier(SE) && cur(NE));
}

// Would the letter at `index`, placed at `y`, cross any earlier letter on the line?
function intersectsEarlierLetters(chars, index, positions, y){
  const currentShape = getCharShape(chars[index]);

  for (let k = index - 1; k >= 0; k--) {
    const distance = y - positions[k];   // how many lineSizes above the current letter
    if (distance < 1) continue;          // a half step from the previous letter: already decided by shapesTouch
    if (distance >= 2) break;            // at 2 or more, tips can at most meet: allowed

    // The previous letter, exactly one lineSize above: an S overlapping an N is allowed here,
    // because overlapMarker adds an extra line to show the overlap (and the X crossings are allowed anyway)
    if (k == index - 1 && distance == 1) continue;

    if (shapesIntersect(getCharShape(chars[k]), currentShape, distance)) return true;
  }
  return false;
}

// Where does the character at `index` go? `positions` holds the characters before it.
function positionOf(chars, index, positions){
  const ch = chars[index];
  const previousY = positions[index - 1];

  // A space doesn't move anything by itself; the letter after it adds the word gap.
  // (A space at the very start has nothing above it: 0 is as good as anything, it's never drawn.)
  if (ch == ' ') return previousY ?? 0;

  // Count the spaces directly before this character, and find the character before those spaces
  let spaces = 0;
  let before = index - 1;
  while (before >= 0 && chars[before] == ' ') {
    spaces++;
    before--;
  }

  if (before < 0)              return firstLetterY(ch, spaces);
  if (spaces > 0)              return wordGapY(chars[before], previousY, ch, spaces);
  if (isPunctuation(ch))       return punctuationY(chars, index, positions);
  if (isPunctuation(chars[before])) return afterPunctuationY(chars[before], previousY, ch);
  return letterAfterLetterY(chars, index, positions);
}

// First character of the line: its top touches the top padding.
// Each leading space moves it down one lineSize.
function firstLetterY(ch, spaces){
  return -letterTop(ch) + spaces;
}

// First letter of a new word: exactly one lineSize of empty space per space,
// from the bottom of the previous word's last character to the top of this one.
// If that leaves the two middles only one lineSize apart (neither has a stroke reaching
// into the gap), the words look too close: add another half lineSize.
function wordGapY(previousCh, previousY, ch, spaces){
  let y = previousY + letterBottom(previousCh) + spaces - letterTop(ch);
  if (y - previousY == 1) y += 0.5;
  return y;
}

// Punctuation goes below everything placed so far on the line, with half a lineSize of empty space
function punctuationY(chars, index, positions){
  let lowest = -Infinity;
  for (let k = 0; k < index; k++) {
    if (chars[k] != ' ') lowest = Math.max(lowest, positions[k] + letterBottom(chars[k]));
  }
  return lowest + 0.5 - letterTop(chars[index]);
}

// Right after punctuation: half a lineSize of empty space below it
function afterPunctuationY(previousCh, previousY, ch){
  return previousY + letterBottom(previousCh) + 0.5 - letterTop(ch);
}

// A letter directly after another letter
function letterAfterLetterY(chars, index, positions){
  const previousShape = getCharShape(chars[index - 1]);
  const currentShape = getCharShape(chars[index]);

  // Half a step if the two letters can't reach each other (previous has nothing pointing down,
  // current has nothing pointing up), or if they wouldn't touch at a full step anyway
  const previousPointsDown = previousShape.some(dir => dir[1] == 1);
  const currentPointsUp = currentShape.some(dir => dir[1] == -1);
  const halfStep = (!previousPointsDown && !currentPointsUp) || !shapesTouch(previousShape, currentShape);

  let step = halfStep ? 0.5 : 1;

  // The letters before the previous one can still be in reach: keep moving down
  // half a step at a time until the current letter no longer crosses any of them
  while (intersectsEarlierLetters(chars, index, positions, positions[index - 1] + step)) {
    step += 0.5;
  }
  return positions[index - 1] + step;
}


// =============================================================================
// 4. Layout
// =============================================================================

// The position of every character in one line.
// `known` can hold the positions already found for the start of the same line: a character's
// position never depends on the ones after it, so only the rest needs placing.
function placeLine(chars, known = []){
  const positions = [...known];
  for (let i = known.length; i < chars.length; i++) {
    positions.push(positionOf(chars, i, positions));
    evenOutSpacing(chars, i, positions);
  }
  return positions;
}

// Three letters in a row, where the middle one came half a step after the first, but the third
// had to be pushed more than a full step down to avoid crossing the first (e.g. "inc": 0.5 then 2).
// Try spacing them evenly instead: the middle a full step after the first, and the third placed
// as usual after it ("inc": 1 then 1). Keep that if the third letter ends up no lower than before.
function evenOutSpacing(chars, i, positions){
  const isLetter = ch => ch != ' ' && !isPunctuation(ch);
  if (i < 2 || !isLetter(chars[i - 2]) || !isLetter(chars[i - 1]) || !isLetter(chars[i])) return;

  const firstStep = positions[i - 1] - positions[i - 2];
  const secondStep = positions[i] - positions[i - 1];
  if (firstStep != 0.5 || secondStep <= 1) return;

  // The middle letter one full step after the first: must not cross anything before it
  const middleY = positions[i - 2] + 1;
  const before = positions.slice(0, i - 1);
  if (intersectsEarlierLetters(chars, i - 1, before, middleY)) return;

  // Place the third letter again, after the moved middle letter
  const thirdY = letterAfterLetterY(chars, i, [...before, middleY]);
  if (thirdY <= positions[i]) {
    positions[i - 1] = middleY;
    positions[i] = thirdY;
  }
}

// The lowest point any character in the line reaches, in lineSizes
function lineBottom(chars, positions){
  let bottom = -Infinity;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] != ' ') bottom = Math.max(bottom, positions[i] + letterBottom(chars[i]));
  }
  return bottom;
}

// Split one line of text into several, so no line reaches further than CONFIG.maxLineLength.
// Words are kept whole: a word that doesn't fit moves to the next line.
function wrapLine(line){
  const words = line.match(/ *[^ ]+| +/g) || [];   // each word together with the spaces before it
  const result = [];
  let current = [];

  for (const word of words) {
    const candidate = [...current, ...word];
    const tooLong = lineBottom(candidate, placeLine(candidate)) * CONFIG.lineSize > CONFIG.maxLineLength;

    if (current.length > 0 && tooLong) {
      result.push(current);                 // this line is full
      current = [...word.trimStart()];      // the word starts the next line (without its spaces)
    }
    else {
      current = candidate;
    }
  }
  result.push(current);
  return result;
}


// =============================================================================
// 5. Compact layout (experimental)
//
// The text is packed as tightly as possible. A guide shape, a circle or a square
// (CONFIG.guideShape), sets how tall each column may be. The code speaks of "the circle" and
// its radius r; for the square, r is how far it reaches from its middle each way.
//
// The columns stand side by side across the circle, so the middle ones are tall and the outer
// ones short (in a square, they're all equally tall). Each column sits 0.5, 1 or 1.5 lineSizes
// after the previous one, whichever packs the text tightest, so columns overlap; but lines of
// different columns never touch (except a letter's tip on the middle of another letter's line):
// gaps between words and around punctuation stretch where needed. Text flows from column to
// column (words kept whole), and each column is centred vertically in the part of the circle
// it crosses, as closely as the half-lineSize grid allows (so the columns line up).
// Several circle sizes are tried, and the most compact result is kept (see compactLayout).
//
// Coordinates here are in pixels, with (0, 0) at the circle's centre.
// =============================================================================

// A column whose middle is at `x`, inside the guide shape (a circle of radius `r`, or a square
// reaching `r` from its middle each way, see CONFIG.guideShape): which y offsets (the pixel y of
// its position 0) keep characters `from` to `to` (not included) inside it?
// Starts from `range` (what the characters before `from` allow) and narrows it.
// Returns { lowest, highest }, or null if no offset works.
// The lines are straight and both shapes are convex, so a line fits exactly when both its ends do.
function fitRange(chars, positions, x, r, from, to, range){
  const L = CONFIG.lineSize;
  const square = CONFIG.guideShape == 'square';
  let { lowest, highest } = range;
  for (let i = from; i < to; i++) {
    const points = glyph(chars[i], chars[i - 1]).points;
    for (let j = 0; j < points.length; j += 2) {
      const pointX = x + points[j] * L;
      if (Math.abs(pointX) > r) return null;
      // How far up and down the guide shape reaches at this x
      const halfChord = square ? r : Math.sqrt(r*r - pointX*pointX);
      const pointY = (positions[i] + points[j + 1]) * L;
      lowest = Math.max(lowest, -halfChord - pointY);
      highest = Math.min(highest, halfChord - pointY);
    }
  }
  return lowest > highest + 1e-9 ? null : { lowest, highest };
}

const ANYWHERE = { lowest: -Infinity, highest: Infinity };

// How far apart (in lineSizes) a column's middle may be from the previous column's. Each new
// column tries these and keeps whichever packs the most text per unit of width. Columns closer
// than 2 lineSizes overlap (each column's strokes reach 1 lineSize to each side), so their lines
// have to dodge each other.
const COLUMN_PITCHES = [0.5, 1, 1.5];
// Used only when none of those fits anything: side by side, without overlapping
const FALLBACK_PITCH = 2;
// Extra distance before the column after a blank line in the text
const BLANK_LINE_PITCH = 2;
// A new column has to sit beside the previous one, not above or below it: their heights must
// overlap by at least this much of the shorter column's height
const SIDE_BY_SIDE = 0.5;
// Columns further apart than this can't come too close to each other
const MAX_REACH = 2;

// How many half steps a word or punctuation mark may be pushed down to keep clear of the previous column
const MAX_PUSH = 8;

// A character's lines (see characterSegments), worked out once per pair of characters, with
// how far left and right they reach (in lineSizes) and an id for the clash table below.
// Characters that look the same share one glyph (and one id), so the clash table stays small.
const glyphs = new Map();       // character + previous character -> glyph
const glyphShapes = new Map();  // the lines, as text -> glyph
function glyph(ch, previousCh){
  const key = ch + '\u0000' + (previousCh ?? '');
  let g = glyphs.get(key);
  if (!g) {
    const segments = characterSegments(ch, previousCh);
    const punctuation = isPunctuation(ch);
    const shape = JSON.stringify(segments) + (punctuation ? 'p' : '');
    g = glyphShapes.get(shape);
    if (!g) {
      const xs = segments.flatMap(s => [s[0], s[2]]);
      g = { id: glyphShapes.size, segments, points: segments.flat(),   // points: x1, y1, x2, y2, x1, ...
            left: Math.min(...xs), right: Math.max(...xs),              // nothing drawn: Infinity, -Infinity
            punctuation };
      glyphShapes.set(shape, g);
    }
    glyphs.set(key, g);
  }
  return g;
}

// The shortest distance between a point and a line, and between two lines (0 if they cross)
function pointSegmentDistance(px, py, [x1, y1, x2, y2]){
  const dx = x2 - x1, dy = y2 - y1;
  const lengthSquared = dx*dx + dy*dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - x1)*dx + (py - y1)*dy) / lengthSquared)) : 0;
  return Math.hypot(px - x1 - t*dx, py - y1 - t*dy);
}

function segmentDistance(a, b){
  const side = ([x1, y1, x2, y2], px, py) => Math.sign((x2 - x1)*(py - y1) - (y2 - y1)*(px - x1));
  const crosses = side(a, b[0], b[1]) * side(a, b[2], b[3]) < 0 &&
                  side(b, a[0], a[1]) * side(b, a[2], a[3]) < 0;
  if (crosses) return 0;
  return Math.min(pointSegmentDistance(a[0], a[1], b), pointSegmentDistance(a[2], a[3], b),
                  pointSegmentDistance(b[0], b[1], a), pointSegmentDistance(b[2], b[3], a));
}

// Lines of two different columns must stay this far apart (centre to centre, in pixels):
// a stroke width, so their round ends don't touch, plus a pixel of visible gap.
// The one exception is meetsAtMiddle below.
function columnClearance(){
  return CONFIG.stroke.width + 1;
}

// Lines from different columns may touch in one way: an outer end of one line lands exactly on
// the middle of the other (a T or V shape). The end must be a tip, not the character's own
// centre point (where a letter's strokes start). The lines must not lie along each other, so a
// line pointing the same way (or backwards) doesn't count. Points without length don't either.
// Punctuation never joins anything: it always keeps the full gap (see clashHeights).
// aCentre and bCentre ([x, y]) are the middles of the characters the two lines belong to.
function meetsAtMiddle(a, b, aCentre, bCentre){
  const endOnMiddle = (line, other, otherCentre) => {
    const [x1, y1, x2, y2] = line, [u1, v1, u2, v2] = other;
    if (x1 == x2 && y1 == y2 || u1 == u2 && v1 == v2) return false;
    const near = (x, y, px, py) => Math.abs(x - px) < 1e-6 && Math.abs(y - py) < 1e-6;
    const isTip = (x, y) => !near(x, y, otherCentre[0], otherCentre[1]);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const tipOnMiddle = (near(u1, v1, mx, my) && isTip(u1, v1)) || (near(u2, v2, mx, my) && isTip(u2, v2));
    if (!tipOnMiddle) return false;
    const parallel = Math.abs((x2 - x1)*(v2 - v1) - (y2 - y1)*(u2 - u1)) < 1e-6;
    return !parallel;   // two straight lines that aren't parallel only meet at that one point
  };
  return endOnMiddle(a, b, bCentre) || endOnMiddle(b, a, aCentre);
}

// Character `a` in one column and `b` in a column `dxHalf` half lineSizes to its right: at which
// differences in height (b's middle minus a's, in quarter lineSizes) do their lines come too
// close (other than meeting at a line's middle)?
// Positions are always whole quarter lineSizes, so this list covers every case. Each case
// is worked out once: the same ones come up over and over while searching.
const clashTable = new Map();
let clashTableSettings = '';
function clashHeights(a, b, dxHalf){
  const settings = CONFIG.lineSize + ',' + CONFIG.stroke.width;   // the table only holds for these
  if (settings != clashTableSettings) {
    clashTable.clear();
    clashTableSettings = settings;
  }
  const key = (a.id * 1e5 + b.id) * 16 + dxHalf;
  let heights = clashTable.get(key);
  if (heights) return heights;

  const L = CONFIG.lineSize;
  const clearance = columnClearance();
  const dx = dxHalf * L / 2;
  const aLines = a.segments.map(s => s.map(v => v * L));
  const mayJoin = !a.punctuation && !b.punctuation;   // punctuation never touches anything (see meetsAtMiddle)
  const reach = Math.ceil((2 + clearance / L) * 4);   // each character reaches at most 1 lineSize up and down
  heights = [];
  for (let q = -reach; q <= reach; q++) {
    const dy = q * L / 4;
    const tooClose = b.segments.some(([x1, y1, x2, y2]) => {
      const line = [dx + x1*L, dy + y1*L, dx + x2*L, dy + y2*L];
      return aLines.some(other => segmentDistance(other, line) < clearance && !(mayJoin && meetsAtMiddle(other, line, [0, 0], [dx, dy])));
    });
    if (tooClose) heights.push(q);
  }
  clashTable.set(key, heights);
  return heights;
}

// The drawn characters of a column (from `from` on), as { glyph, q }: q is the middle's height
// in quarter lineSizes, for a column placed at `offset` (in half lineSizes)
function charItems(chars, positions, from, offset){
  const result = [];
  for (let i = from; i < chars.length; i++) {
    const g = glyph(chars[i], chars[i - 1]);
    if (g.segments.length) result.push({ glyph: g, q: offset*2 + Math.round(positions[i] * 4) });
  }
  return result;
}

// The columns already placed that a new column at `x` could come too close to, as
// { dxHalf, items }: how far left they are (in half lineSizes), and their characters that
// reach far enough right to matter
function neighboursOf(placed, x){
  const L = CONFIG.lineSize;
  const gap = columnClearance() / L;
  const result = [];
  for (const column of placed) {
    const dx = (x - column.x) / L;
    if (dx > MAX_REACH + 1e-9) continue;
    // The new column's lines start at most 1 lineSize left of its middle
    const items = column.items.filter(a => a.glyph.right > dx - 1 - gap);
    if (items.length) result.push({ dxHalf: Math.round(dx * 2), items });
  }
  return result;
}

// Which column offsets (in half lineSizes: offset k puts position 0 at y = k * lineSize / 2)
// would bring these characters (`piece`, worked out for offset 0) too close to the columns
// already placed (`neighbours`, see neighboursOf)? Only offsets from kMin to kMax are looked
// at (when the column can't move anywhere else). Returns a Set of k.
function clashingOffsets(piece, neighbours, kMin = -Infinity, kMax = Infinity){
  const gap = columnClearance() / CONFIG.lineSize;
  const reach = Math.ceil((2 + gap) * 4);   // the most two characters' middles can differ and still clash (in quarter lineSizes)
  const clashes = new Set();
  for (const { dxHalf, items } of neighbours) {
    const limit = dxHalf / 2 - 1 - gap;   // the old column's lines reach at most 1 lineSize right
    for (const b of piece) {
      if (-b.glyph.left <= limit) continue;
      // The old column's characters are in order from top to bottom (q only grows), so the ones
      // close enough in height are a run: find where it starts, and stop when it ends
      const lowestQ = b.q + 2*kMin - reach, highestQ = b.q + 2*kMax + reach;
      let lo = 0, hi = items.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (items[mid].q < lowestQ) lo = mid + 1; else hi = mid;
      }
      for (let j = lo; j < items.length && items[j].q <= highestQ; j++) {
        const a = items[j];
        for (const q of clashHeights(a.glyph, b.glyph, dxHalf)) {
          const twiceK = a.q + q - b.q;   // b's middle must end up at a.q + q
          if (twiceK % 2 == 0) clashes.add(twiceK / 2);
        }
      }
    }
  }
  return clashes;
}

// Pick the column's offset (in half lineSizes) from a range of pixel offsets: the one closest
// to the middle (centring the column vertically) that lies on the half-lineSize grid, so every
// column lines up with the others as if snapped to one grid, and that doesn't clash with the
// previous column. 0 if nothing is drawn; null if no offset works.
function pickOffset({ lowest, highest }, clashes){
  if (lowest == -Infinity) return 0;
  const step = CONFIG.lineSize / 2;
  const middle = (lowest + highest) / 2 / step;
  let best = null;
  for (let k = Math.ceil(lowest / step - 1e-9); k <= Math.floor(highest / step + 1e-9); k++) {
    if (!clashes(k) && (best === null || Math.abs(k - middle) < Math.abs(best - middle))) best = k;
  }
  return best;
}

// Add a word to a column at `x`, inside a circle of radius `r`, keeping clear of the lines of
// the columns already placed (`neighbours`). Returns the grown column, or null if the word doesn't fit.
//
// The word is added piece by piece: letters joined together stay together, but the gap before
// each piece (a word gap, or the gap around a punctuation mark) may be stretched by half steps
// when that's the only way to keep clear of the previous column.
// Placing a piece never moves the characters before it (evenOutSpacing only works on three
// letters in a row, and pieces start after a space or a punctuation mark), so everything
// worked out for the column so far stays valid.
function addWord(column, word, x, r, neighbours){
  let { chars, positions, range, offset } = column;
  // The offsets the column's characters so far can't use. The set is shared with `column` and
  // grown in place; if the word doesn't fit, what was added is taken out again.
  const clashes = column.clashes;
  const added = [];
  const undo = () => { for (const k of added) clashes.delete(k); return null; };
  const step = CONFIG.lineSize / 2;

  for (const piece of word.match(/[.,'"?!]|[^.,'"?!]+/g) || []) {
    const from = chars.length;
    const all = [...chars, ...piece];
    const placed = placeLine(all, positions);   // only the new piece needs placing
    // Only offsets inside the column's current range can be used (pushed down by up to MAX_PUSH)
    const kMin = Math.ceil(range.lowest / step - 1e-9);
    const kMax = Math.floor(range.highest / step + 1e-9) + MAX_PUSH;
    const pieceClashes = clashingOffsets(charItems(all, placed, from, 0), neighbours, kMin, kMax);

    let chosen = null;
    for (let push = 0; push <= MAX_PUSH && !chosen; push++) {
      const pushed = push == 0 ? placed : placed.map((p, i) => i >= from ? p + push / 2 : p);
      const newRange = fitRange(all, pushed, x, r, from, all.length, range);
      if (!newRange) break;   // pushed out of the bottom of the circle
      // Pushing the piece down by `push` half steps is the same, for its own clashes,
      // as moving the whole column down that much
      const best = pickOffset(newRange, k => clashes.has(k) || pieceClashes.has(k + push));
      if (best !== null) chosen = { push, positions: pushed, range: newRange, offset: best };
    }
    if (!chosen) return undo();

    for (const k of pieceClashes) {
      const shifted = k - chosen.push;
      if (!clashes.has(shifted)) { clashes.add(shifted); added.push(shifted); }
    }
    chars = all;
    ({ positions, range, offset } = chosen);
  }
  return { chars, positions, range, offset, clashes };
}

// A word too tall for even the middle column may stick out of the guide circle at the top and
// bottom, in a column of its own (which must still be inside the circle sideways). It's centred
// on the circle's middle, as closely as the grid and the columns already placed allow.
// Returns the column, or null if this column is too far out to the side.
function placeOversized(word, x, r, neighbours){
  const L = CONFIG.lineSize;
  if (Math.abs(x) + L > r) return null;

  const chars = [...word];
  const positions = placeLine(chars);
  let top = Infinity, bottom = -Infinity;
  chars.forEach((ch, i) => {
    if (ch == ' ') return;
    top = Math.min(top, positions[i] + letterTop(ch));
    bottom = Math.max(bottom, positions[i] + letterBottom(ch));
  });
  if (top == Infinity) return null;

  // Offsets are in half lineSizes: -(top + bottom) puts the word's middle on y = 0
  const clashes = clashingOffsets(charItems(chars, positions, 0, 0), neighbours);
  const centre = Math.round(-(top + bottom));
  for (let d = 0; ; d++) {
    for (const k of [centre + d, centre - d]) {
      if (!clashes.has(k)) return { chars, positions, range: { lowest: k * L/2, highest: k * L/2 }, offset: k, clashes: new Set() };
    }
  }
}

// Flow the text into columns across a circle of radius `r`, rightwards from `startX`
// (by default the circle's left edge).
// Each new column tries every distance in COLUMN_PITCHES from the previous one, and keeps the
// one that fits the most text per unit of width (the closest one, if they're equal).
// Returns { columns: [{ chars, positions, x, y }], stacked } (stacked: how many columns ended
// up above or below the previous one instead of beside it), or null if the text doesn't fit.
// The columns are filled without holes: once the text has started, no space is skipped just
// because a word didn't fit (blank lines in the text still leave a gap).
function flowColumns(textLines, r, startX = -(r - CONFIG.lineSize)){
  const L = CONFIG.lineSize;
  const columns = [];
  const placed = [];       // { x, items } of every column so far, for the clash checks
  let lastX = null;        // the previous column's middle (null: nothing drawn yet)
  let firstX = startX;     // where the first column goes (moved right if the first word doesn't fit)

  const emptyColumn = () => ({ chars: [], positions: [], range: ANYWHERE, offset: 0, clashes: new Set() });
  const drawnCount = column => column.chars.filter(ch => ch != ' ').length;

  // How far up and down a column's characters reach, in pixels ({ top, bottom })
  const extentOf = column => {
    let top = Infinity, bottom = -Infinity;
    column.chars.forEach((ch, i) => {
      if (ch == ' ') return;
      top = Math.min(top, column.positions[i] + letterTop(ch));
      bottom = Math.max(bottom, column.positions[i] + letterBottom(ch));
    });
    const y = column.offset * L / 2;
    return { top: top * L + y, bottom: bottom * L + y };
  };
  let lastExtent = null;   // the previous column's (null: nothing drawn yet)

  // Does a column sit beside the previous one, rather than above or below it? Their heights
  // must overlap by at least SIDE_BY_SIDE of the shorter one's height.
  const beside = column => {
    if (!lastExtent) return true;
    const { top, bottom } = extentOf(column);
    const overlap = Math.min(bottom, lastExtent.bottom) - Math.max(top, lastExtent.top);
    const shorter = Math.min(bottom - top, lastExtent.bottom - lastExtent.top);
    return overlap >= SIDE_BY_SIDE * shorter - 1e-9;
  };

  let stacked = 0;   // columns that ended up above or below the previous one instead of beside it

  const commit = ({ column, x }) => {
    columns.push({ chars: column.chars, positions: column.positions, x, y: column.offset * L / 2 });
    placed.push({ x, items: charItems(column.chars, column.positions, 0, column.offset) });
    lastX = x;
    if (drawnCount(column) > 0) {
      if (!beside(column)) stacked++;
      lastExtent = extentOf(column);
    }
  };

  // A column at `x` filled with as many words as fit, from words[i] on
  const fill = (words, i, x, keepSpaces) => {
    const neighbours = neighboursOf(placed, x);
    let column = emptyColumn();
    while (i < words.length) {
      const text = keepSpaces || column.chars.length > 0 ? words[i] : words[i].trimStart();
      const grown = addWord(column, text, x, r, neighbours);
      if (!grown) break;
      column = grown;
      i++;
    }
    return { column, next: i, x };
  };

  for (const textLine of textLines) {
    // A blank line leaves a gap (before anything is drawn, it makes no difference)
    if (!/[^ ]/.test(textLine)) {
      if (lastX !== null) {
        lastX += BLANK_LINE_PITCH * L;
        columns.push({ chars: [], positions: [], x: lastX, y: 0 });
      }
      continue;
    }

    const words = textLine.match(/ *[^ ]+| +/g);
    let i = 0;
    let keepSpaces = true;   // the first column of a text line keeps its leading spaces

    while (i < words.length) {
      // Try each distance from the previous column, and keep the most text per unit of width,
      // preferring the columns that sit beside the previous one (not above or below it).
      // Layouts with columns that don't are ranked lower in the end (see compactLayout).
      const attempts = [];
      const options = lastX === null ? [firstX] : COLUMN_PITCHES.map(p => lastX + p * L);
      for (const x of options) {
        const attempt = fill(words, i, x, keepSpaces);
        if (attempt.next == i) continue;   // not even one word fits
        attempt.score = drawnCount(attempt.column) / (lastX === null ? 1 : x - lastX);
        attempt.beside = beside(attempt.column);
        attempts.push(attempt);
      }
      const mostPerWidth = list => list.reduce((b, a) => !b || a.score > b.score + 1e-9 ? a : b, null);
      let best = mostPerWidth(attempts.filter(a => a.beside)) ?? mostPerWidth(attempts);

      if (!best) {
        const text = keepSpaces ? words[i] : words[i].trimStart();
        // A word too tall for even the middle column sticks out of the circle in a column of its own
        const oversized = !addWord(emptyColumn(), text, 0, r, []);
        if (lastX === null) {
          // Nothing drawn yet: move the first column right. An over-long word waits for the
          // middle, so the rest of the text can pack around it.
          if (oversized && firstX >= -L / 4) {
            const column = placeOversized(text, firstX, r, []);
            if (column) best = { column, next: i + 1, x: firstX };
          }
          if (!best) {
            firstX += L / 2;
            if (firstX + L > r) return null;
            continue;
          }
        }
        else if (oversized) {
          // The closest column that sits beside the previous one, or else just the closest
          let closest = null;
          for (const p of [...COLUMN_PITCHES, FALLBACK_PITCH]) {
            const x = lastX + p * L;
            const column = placeOversized(text, x, r, neighboursOf(placed, x));
            if (!column) continue;
            closest ??= { column, next: i + 1, x };
            if (beside(column)) { best = { column, next: i + 1, x }; break; }
          }
          best ??= closest;
        }
        else {
          // Last resort: a column that doesn't overlap the previous one
          const attempt = fill(words, i, lastX + FALLBACK_PITCH * L, keepSpaces);
          if (attempt.next > i) best = attempt;
        }
        if (!best) return null;
      }

      commit(best);
      i = best.next;
      keepSpaces = false;
    }
  }
  return { columns, stacked };
}

// The guide circles tried: from the smallest the text fits in, in small steps up to this much
// bigger (where ordinary text finds its best layout)...
const RADIUS_SEARCH_FINE = 0.15;
// ...then in bigger steps up to this much bigger (which helps text with an over-long word),
// stopping early once this many bigger circles in a row haven't found anything better
const RADIUS_SEARCH = 1;
const GIVE_UP_AFTER = 4;
// ...but always at least this many lineSizes bigger (short texts have small circles)
const RADIUS_SEARCH_MIN = 5;

// A word counts as hanging off the blob (a stray) when nothing from another column comes
// within this many lineSizes of it (centre line to centre line)
const STRAY_DISTANCE = 1;

// Lay the text out as compactly as possible, using a circle as a guide for how tall each column
// may be. The best layout has, first, the fewest awkward words: stray words hanging off the
// blob (see layoutShape) and columns stacked above or below the previous one instead of beside
// it. Then, the shortest outline around everything drawn (its convex hull): that rewards packing
// the text densely (stretched gaps, ragged edges and empty bands make the outline longer) and
// keeping it round (for the same area, a long thin shape has a longer outline than a round one).
// Returns { layouts, more }: `layouts` are the best few different layouts, best first (see
// ALTERNATIVE_LAYOUTS), each the columns ([{ chars, positions, x, y }]) placed around the guide
// circle's middle; `more()` looks for one more (adding it to `layouts`), and returns whether it found one.
function compactLayouts(textLines){
  const L = CONFIG.lineSize;
  const halfStroke = CONFIG.stroke.width / 2;

  // The layouts at this radius, if the text fits (the lines' round ends reach half a stroke past
  // their end points). The first starts at the circle's left edge (or, if the text doesn't fit
  // from there, halfway to the middle, or at the middle); when the text needs less than the whole
  // width, it's laid out again starting further right so it sits in the middle of the circle
  // (where the columns are tallest), which keeps the result round instead of lopsided.
  // (`thorough` false: only the left edge, just to see whether the text fits at all)
  const layoutsAt = (R, thorough = true) => {
    const r = R - halfStroke;
    const layouts = [];
    let layout = null;
    for (const start of thorough ? [-(r - L), -(r - L) / 2, 0] : [-(r - L)]) {
      layout = flowColumns(textLines, r, start);
      if (layout) break;
    }
    if (!layout) return layouts;
    layouts.push(layout);
    if (!thorough) return layouts;

    const xs = layout.columns.filter(c => c.chars.some(ch => ch != ' ')).map(c => c.x);
    if (xs.length == 0) return layouts;
    const centred = -(Math.max(...xs) - Math.min(...xs)) / 2;   // where the first column goes when centred
    if (Math.abs(centred - Math.min(...xs)) >= L / 4) {
      const again = flowColumns(textLines, r, centred);
      if (again) layouts.push(again);
    }
    return layouts;
  };

  // The smallest radius anything fits in: double it until the text fits, then narrow it down
  let low = 0, high = L + halfStroke;
  for (let k = 0; layoutsAt(high, false).length == 0 && k < 30; k++) {
    low = high;
    high *= 2;
  }
  while (high - low > 1) {
    const mid = (low + high) / 2;
    if (layoutsAt(mid, false).length > 0) high = mid;
    else low = mid;
  }

  // From there up to bigger guide circles, keep the best layout.
  // Past the small steps, give up once several bigger circles in a row haven't helped.
  // (For short texts the circles are small, so always look at least a few lineSizes further.)
  let best = null;
  let sinceBest = 0;
  const found = [];   // every layout looked at, for the alternatives
  const furthest = Math.max(high * (1 + RADIUS_SEARCH), high + RADIUS_SEARCH_MIN * L);
  for (let R = high; R <= furthest; R += R < high * (1 + RADIUS_SEARCH_FINE) ? L / 4 : L) {
    if (R >= high * (1 + RADIUS_SEARCH_FINE) && sinceBest >= GIVE_UP_AFTER) break;
    sinceBest++;
    for (const layout of layoutsAt(R)) {
      const { perimeter, strays } = layoutShape(layout.columns);
      const awkward = strays + layout.stacked;
      found.push({ columns: layout.columns, awkward, perimeter });
      const better = !best || awkward < best.awkward ||
                     (awkward == best.awkward && perimeter < best.perimeter - 1e-6);
      if (better) {
        best = { columns: layout.columns, awkward, perimeter, R };
        sinceBest = 0;
      }
    }
  }
  if (!best) return { layouts: [[]], more: () => false };   // (only if nothing ever fit)

  // The alternatives: as good as the best at avoiding awkward words, and not much less compact,
  // without repeats (the same layout is often found at several radii)
  const L4 = L / 4;
  const sameness = columns => {
    const filled = columns.filter(c => c.chars.some(ch => ch != ' '));
    if (filled.length == 0) return '';
    const left = Math.min(...filled.map(c => c.x)), top = Math.min(...filled.map(c => c.y + c.positions[0]*L));
    return filled.map(c => Math.round((c.x - left) / L4) + ':' +
                           c.positions.map(p => Math.round((c.y + p*L - top) / L4)).join(',')).join('|');
  };
  const seen = new Set();
  const layouts = [];
  const add = f => {
    if (f.awkward != best.awkward || f.perimeter > best.perimeter * ALTERNATIVE_LAYOUTS.within) return false;
    const key = sameness(f.columns);
    if (seen.has(key)) return false;
    seen.add(key);
    layouts.push(f.columns);
    return true;
  };
  for (const f of found.sort((a, b) => a.perimeter - b.perimeter)) {
    add(f);
    if (layouts.length == ALTERNATIVE_LAYOUTS.first) break;
  }

  // More, on request: the best layout's circle and a few bigger ones, with the first column
  // started further right in half-lineSize steps (the search above only tries a few starts)
  const tries = [];
  for (const bigger of [0, 0.25, 0.5, 1, 1.5, 2]) {
    for (let k = 1; k <= 6; k++) tries.push([best.R + bigger * L, k]);
  }
  const more = () => {
    while (tries.length) {
      const [R, k] = tries.shift();
      const r = R - halfStroke;
      const layout = flowColumns(textLines, r, -(r - L) + k * L / 2);
      if (!layout) continue;
      const { perimeter, strays } = layoutShape(layout.columns);
      if (add({ columns: layout.columns, awkward: strays + layout.stacked, perimeter })) return true;
    }
    return false;
  };
  return { layouts, more };
}

// "Try another layout": the search offers up to `first` layouts straight away (more are looked
// for on request), all with an outline at most `within` times as long as the best one's
const ALTERNATIVE_LAYOUTS = { first: 8, within: 1.25 };

// The best compact layout (see compactLayouts)
function compactLayout(textLines){
  return compactLayouts(textLines).layouts[0];
}

// The layouts for the current text and settings, kept until either changes, so stepping
// through them (or changing a colour) doesn't lay the text out again
// (`exhausted`: `more` found nothing new last time)
let layoutCache = { key: null, layouts: [], more: () => false, exhausted: true };
let layoutChoice = 0;   // which of them is shown
function cachedLayouts(textLines){
  const key = JSON.stringify([textLines, CONFIG.lineSize, CONFIG.stroke.width, CONFIG.guideShape]);
  if (key != layoutCache.key) {
    layoutCache = { key, ...compactLayouts(textLines), exhausted: false };
    layoutChoice = 0;
  }
  return layoutCache.layouts;
}

// The shape of a layout: the length of the tightest outline around everything drawn (its
// convex hull: an outline without dents), and how many stray words there are.
// A word is a stray when it hangs off the blob:
//   - nothing from another column comes within STRAY_DISTANCE of it (it's only attached
//     through its own column, whose words are always a word gap apart), or
//   - it lies entirely outside the outline of all the other words.
// Returns { perimeter, strays }.
function layoutShape(columns){
  const L = CONFIG.lineSize;

  // Every end point, with the word it belongs to: [x, y, word];
  // and every line of every column, with its word and box: [x1, y1, x2, y2, word, top, bottom, left, right]
  const points = [];
  const linesByColumn = [];
  let words = 0;
  for (const c of columns) {
    const lines = [];
    let inWord = false;
    c.chars.forEach((ch, i) => {
      if (ch == ' ') { inWord = false; return; }
      if (!inWord) { words++; inWord = true; }
      for (const [x1, y1, x2, y2] of glyph(ch, c.chars[i - 1]).segments) {
        const line = [c.x + x1*L, c.y + (c.positions[i] + y1)*L, c.x + x2*L, c.y + (c.positions[i] + y2)*L, words];
        line.push(Math.min(line[1], line[3]), Math.max(line[1], line[3]), Math.min(line[0], line[2]), Math.max(line[0], line[2]));
        lines.push(line);
        points.push([line[0], line[1], words], [line[2], line[3], words]);
      }
    });
    lines.sort((a, b) => a[5] - b[5]);   // by top, so the ones at a given height can be found quickly
    if (lines.length) linesByColumn.push({ x: c.x, lines });
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hull = convexHull(points);

  let perimeter = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length];
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }

  const strayWords = new Set();

  // Words with nothing from another column nearby (only judged when there are several columns)
  if (linesByColumn.length > 1) {
    const near = STRAY_DISTANCE * L;
    // Close enough? (a quick look at the two lines' boxes first: most pairs are clearly too far apart)
    const close = (a, b) => b[7] - a[8] < near && a[7] - b[8] < near && b[5] - a[6] < near && a[5] - b[6] < near &&
                            segmentDistance(a, b) < near;
    for (const own of linesByColumn) {
      const others = linesByColumn
        .filter(o => o != own && Math.abs(o.x - own.x) <= (2 + STRAY_DISTANCE) * L + 1e-9)
        .sort((a, b) => Math.abs(a.x - own.x) - Math.abs(b.x - own.x));   // nearest first: usually anchors at once
      // This column's lines, word by word
      const byWord = new Map();
      for (const line of own.lines) {
        if (!byWord.has(line[4])) byWord.set(line[4], []);
        byWord.get(line[4]).push(line);
      }
      for (const [word, lines] of byWord) {
        const top = Math.min(...lines.map(l => l[5])) - near, bottom = Math.max(...lines.map(l => l[6])) + near;
        const anchored = others.some(o => {
          // The other column's lines that start above `bottom` and end below `top`
          let hi = o.lines.length, lo = 0;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (o.lines[mid][5] <= bottom) lo = mid + 1; else hi = mid; }
          for (let j = 0; j < lo; j++) {
            const b = o.lines[j];
            if (b[6] < top) continue;
            if (lines.some(a => close(a, b))) return true;
          }
          return false;
        });
        if (!anchored) strayWords.add(word);
      }
    }
  }

  // Words entirely outside the others' outline. Only a word on the outline can be (any other
  // word is inside the whole outline, which is then also the others' outline).
  if (words > 1) {
    for (const word of new Set(hull.map(p => p[2]))) {
      if (strayWords.has(word)) continue;
      const others = convexHull(points, word);
      if (others.length < 3) continue;
      if (points.every(p => p[2] != word || !insideConvex(others, p))) strayWords.add(word);
    }
  }
  return { perimeter, strays: strayWords.size };
}

// The convex hull of points sorted by x (then y), leaving out the points of word `skip`:
// its corners, going round counter-clockwise (Andrew's monotone chain)
function convexHull(sorted, skip = null){
  const cross = (o, a, b) => (a[0] - o[0])*(b[1] - o[1]) - (a[1] - o[1])*(b[0] - o[0]);
  const half = (from, to, step) => {
    const h = [];
    for (let i = from; i != to; i += step) {
      const q = sorted[i];
      if (q[2] === skip) continue;
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  if (sorted.length < 2) return [...sorted];
  return [...half(0, sorted.length, 1), ...half(sorted.length - 1, -1, -1)];
}

// Is point p inside (or on the edge of) a convex outline with its corners going counter-clockwise?
function insideConvex(hull, p){
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if ((b[0] - a[0])*(p[1] - a[1]) - (b[1] - a[1])*(p[0] - a[0]) < -1e-6) return false;
  }
  return true;
}


// =============================================================================
// 6. Drawing (in pixels)
// =============================================================================

// Create an SVG element with the given attributes, and add it to `parent`
function el(tag, attrs = {}, parent){
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// One stroke, in pixels
function drawLine(x1, y1, x2, y2, colour = CONFIG.stroke.color){
  el('line', { x1, y1, x2, y2, stroke: colour, 'stroke-width': CONFIG.stroke.width, 'stroke-linecap': 'round' }, svg);
}

// Every line of a character, as [x1, y1, x2, y2] in lineSizes relative to its middle.
// Used both for drawing and by the compact layout.
function characterSegments(ch, previousCh){
  if (ch == ' ') return [];   // spaces are just a gap: nothing to draw
  if (isPunctuation(ch)) return PUNCTUATION[ch];

  const shape = getCharShape(ch);
  const strokes = shape.map(([dx, dy]) => [0, 0, dx, dy]);   // two strokes, from the middle outwards
  const marker = overlapMarker(getCharShape(previousCh), shape);
  return marker ? [marker, ...strokes] : strokes;
}

// Every line of a column, in pixels, ready to draw. x is the column's middle and y the pixel
// position of position 0. Each line is { x1, y1, x2, y2, middle, kind, punctuation }:
// `middle` is the middle of its original length ([x, y]), and `kind` says which ends may be
// extended (see extendFreeEnds): 'stroke' for a letter's stroke, going from the letter's middle
// (x1, y1) out to its tip (x2, y2), where only the tip may be; 'marker' for the overlap marker
// (see overlapMarker), where both ends may be; null for anything else.
function columnLines(chars, positions, x, y){
  const L = CONFIG.lineSize;
  const lines = [];
  chars.forEach((ch, i) => {
    const cy = y + positions[i] * L;
    const punctuation = isPunctuation(ch);
    for (const [x1, y1, x2, y2] of characterSegments(ch, chars[i - 1])) {
      const line = { x1: x + L*x1, y1: cy + L*y1, x2: x + L*x2, y2: cy + L*y2, punctuation, kind: null };
      line.middle = [(line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2];
      const hasLength = x1 != x2 || y1 != y2;
      if (!punctuation && hasLength) line.kind = x1 == 0 && y1 == 0 ? 'stroke' : 'marker';
      lines.push(line);
    }
  });
  return lines;
}

// After the layout, purely for looks: a free end of a letter's line is drawn half a lineSize
// further, the same way the line goes, to fill out empty space. A letter's stroke may grow at
// its tip (never at the letter's middle); the overlap marker may grow at both ends. An end is
// free when it touches nothing. Growing is only allowed when the added piece touches nothing
// either, or its new end lands exactly on the middle of another letter's line (the middle of
// that line's original length: added pieces don't count). Punctuation is never extended and
// never touched. The added pieces stay within the drawing's box, so the picture keeps its size.
// Lines are looked at in reading order (a marker's top end first), and each extension counts as
// soon as it's made. Changes `lines` (see columnLines) in place.
function extendFreeEnds(lines){
  if (!CONFIG.extendEnds || lines.length == 0) return;
  const clearance = columnClearance();
  const { left, right, top, bottom } = linesBox(lines);
  const segment = l => [l.x1, l.y1, l.x2, l.y2];
  const same = (a, b) => Math.abs(a - b) < 1e-6;
  // Could line `o` be within `reach` of the box from (ax, ay) to (bx, by)? (a quick first look)
  const nearBox = (o, ax, ay, bx, by, reach) =>
    Math.min(o.x1, o.x2) - reach < Math.max(ax, bx) && Math.max(o.x1, o.x2) + reach > Math.min(ax, bx) &&
    Math.min(o.y1, o.y2) - reach < Math.max(ay, by) && Math.max(o.y1, o.y2) + reach > Math.min(ay, by);

  // May `line`'s end at (ex, ey) grow to (nx, ny)?
  const mayGrow = (line, ex, ey, nx, ny) => {
    // The end must touch nothing
    const endTouches = lines.some(o => o != line && nearBox(o, ex, ey, ex, ey, clearance) &&
                                       pointSegmentDistance(ex, ey, segment(o)) < clearance);
    if (endTouches) return false;
    if (nx < left - 1e-6 || nx > right + 1e-6 || ny < top - 1e-6 || ny > bottom + 1e-6) return false;

    // The added piece may touch nothing, except with its new end exactly on a letter line's middle
    const added = [ex, ey, nx, ny];
    return lines.every(o => {
      if (o == line || !nearBox(o, ex, ey, nx, ny, clearance)) return true;
      if (segmentDistance(added, segment(o)) >= clearance) return true;
      if (o.punctuation || (o.x1 == o.x2 && o.y1 == o.y2)) return false;
      if (!same(nx, o.middle[0]) || !same(ny, o.middle[1])) return false;
      const parallel = Math.abs((nx - ex)*(o.y2 - o.y1) - (ny - ey)*(o.x2 - o.x1)) < 1e-6;
      return !parallel;
    });
  };

  for (const line of lines) {
    if (!line.kind) continue;
    // Half the line's original length, the way it goes (a diagonal grows half a step each way)
    const dx = (line.x2 - line.x1) / 2, dy = (line.y2 - line.y1) / 2;

    // The marker's first end (its top), backwards
    if (line.kind == 'marker' && mayGrow(line, line.x1, line.y1, line.x1 - dx, line.y1 - dy)) {
      line.x1 -= dx;
      line.y1 -= dy;
    }
    // The stroke's tip, or the marker's other end, forwards
    if (mayGrow(line, line.x2, line.y2, line.x2 + dx, line.y2 + dy)) {
      line.x2 += dx;
      line.y2 += dy;
    }
  }
}

// The box around a set of lines (see columnLines), through their end points: { left, right, top, bottom }
function linesBox(lines){
  return {
    left: Math.min(...lines.map(l => Math.min(l.x1, l.x2))),
    right: Math.max(...lines.map(l => Math.max(l.x1, l.x2))),
    top: Math.min(...lines.map(l => Math.min(l.y1, l.y2))),
    bottom: Math.max(...lines.map(l => Math.max(l.y1, l.y2))),
  };
}

// Draw lines (see columnLines), moved by dx, dy
// (in each line's own `colour`, if it has one)
function drawLines(lines, dx = 0, dy = 0){
  for (const l of lines) drawLine(l.x1 + dx, l.y1 + dy, l.x2 + dx, l.y2 + dy, l.colour);
}

// The colour of the n-th column (counting only columns with something in them), see CONFIG.columnColours
function columnColour(n){
  return CONFIG.columnColours == 'alternate' && n % 2 == 1 ? CONFIG.secondColor : CONFIG.stroke.color;
}

// The smallest circle around a set of points ([x, y]): { x, y, r } (Welzl's algorithm, with the
// points in a shuffled order, which makes it fast)
function enclosingCircle(points){
  const ps = points.slice();
  let seed = 1;
  for (let i = ps.length - 1; i > 0; i--) {   // a fixed shuffle, so the result never jitters
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [ps[i], ps[j]] = [ps[j], ps[i]];
  }
  const inside = (c, [x, y]) => Math.hypot(x - c.x, y - c.y) <= c.r + 1e-7;
  const two = ([ax, ay], [bx, by]) => ({ x: (ax + bx) / 2, y: (ay + by) / 2, r: Math.hypot(ax - bx, ay - by) / 2 });
  const three = (a, b, c) => {
    const [ax, ay] = a, [bx, by] = b, [cx, cy] = c;
    const d = 2 * (ax*(by - cy) + bx*(cy - ay) + cx*(ay - by));
    if (Math.abs(d) < 1e-12) {   // in a line: the circle through the two furthest apart
      return [two(a, b), two(a, c), two(b, c)].reduce((m, k) => k.r > m.r ? k : m);
    }
    const a2 = ax*ax + ay*ay, b2 = bx*bx + by*by, c2 = cx*cx + cy*cy;
    const x = (a2*(by - cy) + b2*(cy - ay) + c2*(ay - by)) / d;
    const y = (a2*(cx - bx) + b2*(ax - cx) + c2*(bx - ax)) / d;
    return { x, y, r: Math.hypot(ax - x, ay - y) };
  };
  let c = { x: ps[0][0], y: ps[0][1], r: 0 };
  for (let i = 1; i < ps.length; i++) {
    if (inside(c, ps[i])) continue;
    c = { x: ps[i][0], y: ps[i][1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(c, ps[j])) continue;
      c = two(ps[i], ps[j]);
      for (let k = 0; k < j; k++) if (!inside(c, ps[k])) c = three(ps[i], ps[j], ps[k]);
    }
  }
  return c;
}

// The frame around a compact drawing (see CONFIG.frame), drawn half a lineSize clear of the lines:
//   'guide': the guide shape (the smallest circle around the drawing, or a square);
//   'rectangle': the smallest rectangle around the drawing;
//   'blob': the tightest outline without dents (around the convex hull), with rounded corners.
// The rectangle and the blob only frame the result: they don't guide the layout.
// Returns { left, right, top, bottom, draw(dx, dy, attrs) }: what the frame covers (its stroke
// included), and a function that draws it moved by dx, dy.
function frameAround(lines, box){
  const stroke = CONFIG.frameWidth;   // the frame's own thickness
  // From a line's end point to the middle of the frame's stroke (past the line's round end,
  // the gap and half the frame), and to the frame's outer edge
  const away = CONFIG.stroke.width / 2 + CONFIG.lineSize / 2 + stroke / 2;
  const reach = away + stroke / 2;
  const square = (x, y, halfW, halfH) => ({
    left: x - halfW - stroke/2, right: x + halfW + stroke/2, top: y - halfH - stroke/2, bottom: y + halfH + stroke/2,
    draw: (dx, dy, attrs) => el('rect', { x: x - halfW + dx, y: y - halfH + dy, width: 2*halfW, height: 2*halfH, ...attrs }, svg),
  });
  const midX = (box.left + box.right) / 2, midY = (box.top + box.bottom) / 2;
  const halfW = (box.right - box.left) / 2 + away, halfH = (box.bottom - box.top) / 2 + away;

  if (CONFIG.frame == 'rectangle') return square(midX, midY, halfW, halfH);
  if (CONFIG.frame == 'guide' && CONFIG.guideShape == 'square') {
    const half = Math.max(halfW, halfH);
    return square(midX, midY, half, half);
  }
  const points = lines.flatMap(l => [[l.x1, l.y1], [l.x2, l.y2]]);
  if (CONFIG.frame == 'guide') {
    const c = enclosingCircle(points);
    const r = c.r + away;
    return {
      left: c.x - r - stroke/2, right: c.x + r + stroke/2, top: c.y - r - stroke/2, bottom: c.y + r + stroke/2,
      draw: (dx, dy, attrs) => el('circle', { cx: c.x + dx, cy: c.y + dy, r, ...attrs }, svg),
    };
  }

  // The blob: the convex hull pushed out by `away`, its corners rounded (arcs around each corner)
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let hull = convexHull(points).filter((p, i, h) => {
    const q = h[(i + 1) % h.length];
    return h.length == 1 || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9;
  });
  const extent = { left: box.left - reach, right: box.right + reach, top: box.top - reach, bottom: box.bottom + reach };
  if (hull.length == 1) {   // a single point: a circle
    const [x, y] = hull[0];
    return { ...extent, draw: (dx, dy, attrs) => el('circle', { cx: x + dx, cy: y + dy, r: away, ...attrs }, svg) };
  }
  // Go round clockwise on screen, so each edge's outside is to its left: (dy, -dx)
  let area = 0;
  hull.forEach(([x1, y1], i) => { const [x2, y2] = hull[(i + 1) % hull.length]; area += x1*y2 - x2*y1; });
  if (area < 0) hull = hull.reverse();
  const outward = hull.map(([x1, y1], i) => {
    const [x2, y2] = hull[(i + 1) % hull.length], length = Math.hypot(x2 - x1, y2 - y1);
    return [(y2 - y1) / length * away, -(x2 - x1) / length * away];
  });
  const f = v => v.toFixed(2);
  return {
    ...extent,
    draw: (dx, dy, attrs) => {
      const n = hull.length;
      const at = (i, normal) => [hull[i][0] + normal[0] + dx, hull[i][1] + normal[1] + dy];
      const [sx, sy] = at(0, outward[n - 1]);
      let d = `M${f(sx)} ${f(sy)}`;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = at(i, outward[i]);                  // around corner i...
        const [bx, by] = at((i + 1) % n, outward[i]);        // ...then along edge i
        d += ` A${f(away)} ${f(away)} 0 0 1 ${f(ax)} ${f(ay)} L${f(bx)} ${f(by)}`;
      }
      el('path', { d: d + ' Z', ...attrs }, svg);
    },
  };
}

// When the previous letter's S and this letter's N lie on top of each other, add an extra
// line half a lineSize beside them (from the N tip down to the middle) to show the overlap.
// Returns that line, or null if there's no overlap.
function overlapMarker(previousShape, currentShape){
  if (!(previousShape.includes(S) && currentShape.includes(N))) return null;

  // A diagonal on that side would cross the extra line through its middle.
  // (An E or W only touches its tip, which is fine.)
  const rightCrossed = currentShape.includes(NE) || previousShape.includes(SE);
  const leftCrossed = currentShape.includes(NW) || previousShape.includes(SW);

  // Right by default, left if only the right is crossed,
  // and a diagonal from top-left to bottom-right if both sides are crossed (e.g. gt)
  let xTop, xBottom;
  if (!rightCrossed)     { xTop = 0.5;  xBottom = 0.5; }
  else if (!leftCrossed) { xTop = -0.5; xBottom = -0.5; }
  else                   { xTop = -0.5; xBottom = 0.5; }

  return [xTop, -1, xBottom, 0];
}


// =============================================================================
// 7. Render
// =============================================================================

// While typing, wait for a short pause before drawing again if drawing is slow (long text in
// the compact shape), so keystrokes don't pile up behind each other
let lastRenderTime = 0;
let renderTimer = null;
function scheduleRender(){
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, lastRenderTime > 50 ? 150 : 0);
}

function render(){
  const started = performance.now();
  readSettings();
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  preview.replaceChildren(svg);

  const textLines = input.value.split('\n');
  const [w, h] = CONFIG.shape == 'compact' ? renderCompact(textLines) : renderRectangle(textLines);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Background: added after measuring (so it doesn't count as part of the drawing),
  // and as the first element (so it sits behind the lines). Part of the SVG, so downloads keep it.
  const background = el('rect', { x: 0, y: 0, width: w, height: h, fill: CONFIG.background });
  svg.insertBefore(background, svg.firstChild);

  applyZoom();   // the new drawing keeps the current zoom
  lastRenderTime = performance.now() - started;
}

// Columns from left to right, each wrapped at the maximum height. Returns the image size.
function renderRectangle(textLines){
  const { lineSize, lineSpacing, padding } = CONFIG;
  let column = 0;   // counts the columns actually drawn, including wrapped ones
  const lines = [];

  for (const textLine of textLines) {
    for (const chars of wrapLine(textLine)) {
      const x = padding.left + lineSize + (lineSize*2 + lineSpacing) * column;
      lines.push(...columnLines(chars, placeLine(chars), x, padding.top));
      column++;
    }
  }
  drawLines(lines);   // (free line ends are only extended in the compact shape)

  // The drawing plus padding (at least the padding, when there's nothing to draw)
  const box = linesBox(lines);
  return [
    Math.ceil(Math.max(box.right + padding.right, padding.left + padding.right)),
    Math.ceil(Math.max(box.bottom + padding.bottom, padding.top + padding.bottom)),
  ];
}

// A column's guide: a thin line from its first character's middle to its last one's, with a
// dot on each character's middle, like beads on a string. x is the column's middle and y the
// pixel position of position 0. Preview only (class "guide").
function drawLineGuide(chars, positions, x, y){
  const L = CONFIG.lineSize;
  const middles = [];
  chars.forEach((ch, i) => { if (ch != ' ') middles.push(y + positions[i] * L); });
  if (middles.length == 0) return;
  const colour = '#20c997';
  el('line', { class: 'guide', x1: x, y1: middles[0], x2: x, y2: middles[middles.length - 1],
               stroke: colour, 'stroke-width': 1.5, 'stroke-opacity': 0.85, 'stroke-linecap': 'round' }, svg);
  for (const my of middles) el('circle', { class: 'guide', cx: x, cy: my, r: 2.5, fill: colour }, svg);
}

// The text laid out compactly (see compactLayout), with the padding around the text.
// Returns the image size.
function renderCompact(textLines){
  const layouts = cachedLayouts(textLines);
  layoutChoice = Math.min(layoutChoice, layouts.length - 1);
  showLayoutChoice(layouts.length);
  const columns = layouts[layoutChoice];

  // Each column's lines, in its colour
  const lines = [];
  let filled = 0;
  for (const c of columns) {
    const own = columnLines(c.chars, c.positions, c.x, c.y);
    if (own.length == 0) continue;
    const colour = columnColour(filled++);
    for (const line of own) line.colour = colour;
    lines.push(...own);
  }
  const { padding } = CONFIG;
  if (lines.length == 0) return [padding.left + padding.right, padding.top + padding.bottom];

  const box = linesBox(lines);
  extendFreeEnds(lines);   // (stays inside the box)

  // What's drawn reaches half a stroke past the lines' end points (their round ends), or the frame's
  const stroke = CONFIG.stroke.width;
  let extent = { left: box.left - stroke/2, right: box.right + stroke/2, top: box.top - stroke/2, bottom: box.bottom + stroke/2 };
  const frame = CONFIG.frame != 'none' ? frameAround(lines, box) : null;
  if (frame) extent = frame;

  // Move the drawing to just inside the padding
  const dx = padding.left - extent.left, dy = padding.top - extent.top;
  drawLines(lines, dx, dy);
  if (frame) {
    const colour = CONFIG.frameSameColor ? CONFIG.stroke.color : CONFIG.frameColor;
    const look = { fill: 'none', stroke: colour, 'stroke-width': CONFIG.frameWidth, 'stroke-linejoin': 'round' };
    frame.draw(dx, dy, look);
  }

  // Preview only: string each column's characters on a line, so each line of text can be
  // followed through the overlapping columns (removed from downloads, see svgString)
  if (CONFIG.showGuide) {
    for (const c of columns) drawLineGuide(c.chars, c.positions, dx + c.x, dy + c.y);
  }
  return [Math.ceil(extent.right - extent.left + padding.left + padding.right),
          Math.ceil(extent.bottom - extent.top + padding.top + padding.bottom)];
}

// "Try another layout": show which of the `count` layouts found so far is drawn, and step
// through them. Past the last one, look for another (until none is left to find).
function showLayoutChoice(count){
  byId('layoutLabel').textContent = `Layout ${layoutChoice + 1} / ${count}`;
  byId('layoutPrev').disabled = layoutChoice == 0;
  byId('layoutNext').disabled = layoutChoice >= count - 1 && layoutCache.exhausted;
}
byId('layoutPrev').onclick = () => { layoutChoice--; render(); };
byId('layoutNext').onclick = () => {
  if (layoutChoice >= layoutCache.layouts.length - 1 && !layoutCache.more()) {
    layoutCache.exhausted = true;
    showLayoutChoice(layoutCache.layouts.length);
    return;
  }
  layoutChoice++;
  render();
};


// =============================================================================
// Zoom (preview only: downloads always use the real size)
// =============================================================================

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
let zoom = 1;

// Show the drawing at the current zoom. Only the displayed size changes (through CSS);
// the SVG's own width and height, which the downloads use, stay the same.
function applyZoom(){
  svg.style.width = svg.getAttribute('width') * zoom + 'px';
  svg.style.height = svg.getAttribute('height') * zoom + 'px';

  byId('zoomReset').textContent = Math.round(zoom * 100) + '%';
  byId('zoomOut').disabled = zoom == ZOOM_LEVELS[0];
  byId('zoomIn').disabled = zoom == ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
}

// Move one zoom level in or out (+1 or -1)
function changeZoom(direction){
  const index = ZOOM_LEVELS.indexOf(zoom) + direction;
  zoom = ZOOM_LEVELS[Math.min(Math.max(index, 0), ZOOM_LEVELS.length - 1)];
  applyZoom();
}

byId('zoomIn').onclick = () => changeZoom(+1);
byId('zoomOut').onclick = () => changeZoom(-1);
byId('zoomReset').onclick = () => { zoom = 1; applyZoom(); };


// =============================================================================
// 8. Downloads
// =============================================================================

function download(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The drawing as SVG text, at its real size (without the preview's zoom)
function svgString(){
  const copy = svg.cloneNode(true);
  copy.removeAttribute('style');
  copy.querySelectorAll('.guide').forEach(guide => guide.remove());   // the line guides are preview only
  return new XMLSerializer().serializeToString(copy);
}

byId('dlSvg').onclick = () =>
  download(new Blob([svgString()], { type: 'image/svg+xml' }), 'image.svg');

byId('dlPng').onclick = () => {
  const scale = 2;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = svg.width.baseVal.value * scale;
    c.height = svg.height.baseVal.value * scale;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(b => download(b, 'image.png'), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString());
};

input.addEventListener('input', scheduleRender);

const settings = byId('settings');
settings.addEventListener('input', scheduleRender);
settings.addEventListener('reset', () => setTimeout(render));   // wait until the form has put the defaults back

render();
