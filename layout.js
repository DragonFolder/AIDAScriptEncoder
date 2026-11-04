// =============================================================================
// AIDAScript layout: where every character of the text goes.
//
// No drawing and nothing on the page here, so it can run both on the page (index.html loads it
// before index.js) and in a background worker (layout-worker.js), which lays out the compact
// shape without freezing the page.
//
// Contents:
//   Settings          – CONFIG, the settings and their defaults
//   2. Shapes          – what each character looks like
//   3. Spacing rules   – how far below the previous character each one goes
//   4. Layout          – placing a whole line, and wrapping long lines
//   5. Compact layout  – the experimental compact shape
//   Strokes           – every line of a character
//
// Units: the shape and spacing code works in "lineSizes" (1 = the length of one
// full stroke). The compact layout works in pixels.
// =============================================================================


// =============================================================================
// Settings
// =============================================================================

// The settings, with their defaults. On the page, the "Settings" panel overwrites them before
// every render (see readSettings in index.js); in the worker, each request does.
const CONFIG = {
  lineSize: 20,          // length of one full stroke, in pixels
  lineSpacing: 10,       // extra gap between two columns of text, in pixels (rectangle only)
  maxLineLength: 400,    // how far down a column may reach (from the top padding) before wrapping, in pixels (rectangle only)
  padding: { top: 30, right: 30, bottom: 30, left: 30 },
  stroke: { color: '#000000', width: 5 },
  background: '#ffffff',
  transparent: false,    // no background at all (the downloaded PNG and SVG are see-through)
  shape: 'rectangle',    // 'rectangle' or 'compact'
  guideShape: 'circle',  // compact only: the outline that guides how tall each column may be (see GUIDE_SHAPES)
  guideRatio: 1,         // compact only: the guide shape's width : height (1 keeps it as it is, see guideShape)
  guideRotation: 0,      // compact only: how far the guide shape is turned, clockwise, in degrees
  guideFit: 0,           // compact only: from 0 (as tight as possible) to 1 (follow the guide shape closely), see compactLayouts
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
// The text is packed as tightly as possible. A guide shape (CONFIG.guideShape, see
// GUIDE_SHAPES) sets how tall each column may be. The code speaks of "the circle" and its
// radius r; for the other shapes, r is their size (the same shape r times as big as in GUIDE_SHAPES).
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

// The guide shapes, at size 1, centred on (0, 0) (y goes down), before they're stretched and
// turned (see guideShape). Each has:
//   halfWidth: how far it reaches to each side;
//   span(x): how far it reaches up and down at x, as [top, bottom] (null if x is outside it);
//   gauge(x, y): how big the shape must be to reach the point (x, y): 1 on its outline, and
//     twice as big for a point twice as far out (used for the frame and for guideFit);
//   area: its area (at size 1);
//   outline: its corners ([x, y], going round), or for the circle, ellipse: [half width, half height].
// All are convex, so a straight line is inside exactly when both its ends are.
const SQRT3 = Math.sqrt(3);
const GUIDE_SHAPES = {
  circle: {
    halfWidth: 1,
    span: x => Math.abs(x) > 1 ? null : [-Math.sqrt(1 - x*x), Math.sqrt(1 - x*x)],
    gauge: (x, y) => Math.hypot(x, y),
    area: Math.PI, ellipse: [1, 1],
  },
  // (a square, until stretched)
  rectangle: {
    halfWidth: 1,
    span: x => Math.abs(x) > 1 ? null : [-1, 1],
    gauge: (x, y) => Math.max(Math.abs(x), Math.abs(y)),
    area: 4, outline: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  },
  // Flat on top and bottom, corners at the left and right
  hexagon: {
    halfWidth: 1,
    span: x => Math.abs(x) > 1 ? null : Math.abs(x) <= 0.5 ? [-SQRT3/2, SQRT3/2] : [-SQRT3 * (1 - Math.abs(x)), SQRT3 * (1 - Math.abs(x))],
    gauge: (x, y) => Math.max(2 * Math.abs(y) / SQRT3, Math.abs(x) + Math.abs(y) / SQRT3),
    area: 3 * SQRT3 / 2,
    outline: [[-1, 0], [-0.5, -SQRT3/2], [0.5, -SQRT3/2], [1, 0], [0.5, SQRT3/2], [-0.5, SQRT3/2]],
  },
  diamond: {
    halfWidth: 1,
    span: x => Math.abs(x) > 1 ? null : [-(1 - Math.abs(x)), 1 - Math.abs(x)],
    gauge: (x, y) => Math.abs(x) + Math.abs(y),
    area: 2, outline: [[0, -1], [1, 0], [0, 1], [-1, 0]],
  },
  // Pointing up, with its middle (where its three heights meet) on (0, 0)
  triangle: {
    halfWidth: 1,
    span: x => Math.abs(x) > 1 ? null : [SQRT3 * Math.abs(x) - 2 / SQRT3, 1 / SQRT3],
    gauge: (x, y) => Math.max(SQRT3 * y, (3 * Math.abs(x) - SQRT3 * y) / 2),
    area: SQRT3, outline: [[0, -2 / SQRT3], [1, 1 / SQRT3], [-1, 1 / SQRT3]],
  },
};

// The guide shape as used: CONFIG.guideShape, stretched to CONFIG.guideRatio (width : height,
// keeping its area) and then turned CONFIG.guideRotation degrees clockwise about its middle.
// Like the shapes in GUIDE_SHAPES, but with `left` and `right` (how far it reaches to each side,
// which can differ once it's turned) instead of halfWidth; its outline is turned too, and an
// ellipse has `rotation` (degrees). Made again only when one of those settings changes.
let guideCache = { key: null, shape: null };
function guideShape(){
  const key = [CONFIG.guideShape, CONFIG.guideRatio, CONFIG.guideRotation].join('|');
  if (key == guideCache.key) return guideCache.shape;
  const base = GUIDE_SHAPES[CONFIG.guideShape] ?? GUIDE_SHAPES.circle;
  const ratio = CONFIG.guideRatio > 0 ? CONFIG.guideRatio : 1;
  const angle = ((CONFIG.guideRotation % 360) + 360) % 360;
  let shape;

  if (ratio == 1 && angle == 0) {
    // As it is (the same sums as always)
    shape = { ...base, left: -base.halfWidth, right: base.halfWidth, rotation: 0 };
  } else {
    // A point of the stretched, turned shape = turn(stretch(point of the shape)): stretched by
    // sx across and sy up and down (sx * sy = 1, so the area stays), then turned
    const sx = Math.sqrt(ratio), sy = 1 / sx;
    const t = angle * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
    const fromBase = (x, y) => [cos * x * sx - sin * y * sy, sin * x * sx + cos * y * sy];
    const toBase = (x, y) => [(cos * x + sin * y) / sx, (-sin * x + cos * y) / sy];
    shape = { gauge: (x, y) => base.gauge(...toBase(x, y)), area: base.area, rotation: angle };

    if (base.ellipse) {
      // An ellipse with half axes sx and sy, turned: at x, the y where it's on the outline solve
      // A y² + B y + C = 0 (from |toBase(x, y)| = 1)
      const A = (sin / sx) ** 2 + (cos / sy) ** 2;
      const Bx = 2 * cos * sin * (1 / (sx * sx) - 1 / (sy * sy));
      const Cx = (cos / sx) ** 2 + (sin / sy) ** 2;
      const half = Math.sqrt((sx * cos) ** 2 + (sy * sin) ** 2);
      Object.assign(shape, {
        left: -half, right: half, ellipse: [sx, sy],
        span(x) {
          if (Math.abs(x) > half + 1e-12) return null;
          const B = Bx * x, C = Cx * x * x - 1, d = Math.sqrt(Math.max(0, B * B - 4 * A * C));
          return [(-B - d) / (2 * A), (-B + d) / (2 * A)];
        },
      });
    } else {
      // A polygon: at x, where the vertical line crosses its sides
      const corners = base.outline.map(([x, y]) => fromBase(x, y));
      const xs = corners.map(p => p[0]);
      const left = Math.min(...xs), right = Math.max(...xs);
      Object.assign(shape, {
        left, right, outline: corners,
        span(x) {
          if (x < left - 1e-12 || x > right + 1e-12) return null;
          let top = Infinity, bottom = -Infinity;
          corners.forEach(([x1, y1], i) => {
            const [x2, y2] = corners[(i + 1) % corners.length];
            if ((x < Math.min(x1, x2) - 1e-12) || (x > Math.max(x1, x2) + 1e-12)) return;
            const ys = Math.abs(x2 - x1) < 1e-12 ? [y1, y2] : [y1 + (y2 - y1) * (x - x1) / (x2 - x1)];
            for (const y of ys) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
          });
          return top > bottom ? null : [top, bottom];
        },
      });
    }
  }
  guideCache = { key, shape };
  return shape;
}

// A column whose middle is at `x`, inside the guide shape (of size `r`, see GUIDE_SHAPES): which
// y offsets (the pixel y of its position 0) keep characters `from` to `to` (not included) inside it?
// Starts from `range` (what the characters before `from` allow) and narrows it.
// Returns { lowest, highest }, or null if no offset works.
// The lines are straight and the shapes convex, so a line fits exactly when both its ends do.
function fitRange(chars, positions, x, r, from, to, range){
  const L = CONFIG.lineSize;
  const shape = guideShape();
  let { lowest, highest } = range;
  for (let i = from; i < to; i++) {
    const points = glyph(chars[i], chars[i - 1]).points;
    for (let j = 0; j < points.length; j += 2) {
      const pointX = x + points[j] * L;
      // How far up and down the guide shape reaches at this x
      const span = shape.span(pointX / r);
      if (!span) return null;
      const pointY = (positions[i] + points[j + 1]) * L;
      lowest = Math.max(lowest, span[0] * r - pointY);
      highest = Math.min(highest, span[1] * r - pointY);
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
  const shape = guideShape();
  if (x - L < r * shape.left || x + L > r * shape.right) return null;

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
function flowColumns(textLines, r, startX = r * guideShape().left + CONFIG.lineSize){
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
            if (firstX + L > r * guideShape().right) return null;
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
          // Last resort: a column that doesn't overlap the previous one, or failing that, one
          // further on. (In a narrow corner of a stretched or turned guide shape, the columns
          // grow taller only slowly, so a long word may need to go some way along.)
          const right = r * guideShape().right;
          for (let x = lastX + FALLBACK_PITCH * L; x + L <= right + 1e-9; x += L / 2) {
            const attempt = fill(words, i, x, keepSpaces);
            if (attempt.next > i) { best = attempt; break; }
          }
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
// ...and the whole search never takes longer than about this many milliseconds (a safety net:
// normally it takes far less)
const SEARCH_TIME_LIMIT = 3000;
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
    const edge = r * guideShape().left + L;   // (the first column, at the left edge)
    const layouts = [];
    let layout = null;
    for (const start of thorough ? [edge, edge / 2, 0] : [edge]) {
      layout = flowColumns(textLines, r, start);
      if (layout) break;
    }
    if (!layout) return layouts;
    layouts.push(layout);
    if (!thorough) return layouts;

    const xs = layout.columns.filter(c => c.chars.some(ch => ch != ' ')).map(c => c.x);
    if (xs.length == 0) return layouts;
    const middle = r * (guideShape().left + guideShape().right) / 2;   // (the guide's middle, sideways)
    const centred = middle - (Math.max(...xs) - Math.min(...xs)) / 2;  // where the first column goes when centred
    if (Math.abs(centred - Math.min(...xs)) >= L / 4) {
      const again = flowColumns(textLines, r, centred);
      if (again) layouts.push(again);
    }
    return layouts;
  };

  // The smallest radius anything fits in: double it until the text fits, then narrow it down
  // (The whole search stops after SEARCH_TIME_LIMIT, using the best layout found by then.)
  const deadline = Date.now() + SEARCH_TIME_LIMIT;
  let low = 0, high = L + halfStroke;
  for (let k = 0; layoutsAt(high, false).length == 0; k++) {
    // (it should always fit eventually; if it somehow never does, give up rather than search on:
    // each bigger circle takes longer to try, so this can't go on for long)
    if (k == 30 || Date.now() > deadline) return { layouts: [[]], more: () => false };
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
  // How good a layout is: first, the fewest awkward words; then the lowest score: the outline's
  // length, made longer (by up to GUIDE_FIT_WEIGHT times, with CONFIG.guideFit at 1) for leaving
  // more of the guide shape around the drawing empty (see layoutShape)
  const judge = layout => {
    const { perimeter, strays, fill } = layoutShape(layout.columns);
    const score = perimeter * (1 + GUIDE_FIT_WEIGHT * CONFIG.guideFit * (1 - fill));
    return { columns: layout.columns, awkward: strays + layout.stacked, score };
  };
  let best = null;
  let sinceBest = 0;
  const found = [];   // every layout looked at, for the alternatives
  const furthest = Math.max(high * (1 + RADIUS_SEARCH), high + RADIUS_SEARCH_MIN * L);
  for (let R = high; R <= furthest; R += R < high * (1 + RADIUS_SEARCH_FINE) ? L / 4 : L) {
    if (R >= high * (1 + RADIUS_SEARCH_FINE) && sinceBest >= GIVE_UP_AFTER) break;
    if (best && Date.now() > deadline) break;   // (taking too long: the best found so far will do)
    sinceBest++;
    for (const layout of layoutsAt(R)) {
      const judged = judge(layout);
      found.push(judged);
      const better = !best || judged.awkward < best.awkward ||
                     (judged.awkward == best.awkward && judged.score < best.score - 1e-6);
      if (better) {
        best = { ...judged, R };
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
    if (f.awkward != best.awkward || f.score > best.score * ALTERNATIVE_LAYOUTS.within) return false;
    const key = sameness(f.columns);
    if (seen.has(key)) return false;
    seen.add(key);
    layouts.push(f.columns);
    return true;
  };
  for (const f of found.sort((a, b) => a.score - b.score)) {
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
      const layout = flowColumns(textLines, r, r * guideShape().left + L + k * L / 2);
      if (!layout) continue;
      if (add(judge(layout))) return true;
    }
    return false;
  };
  return { layouts, more };
}

// "Try another layout": the search offers up to `first` layouts straight away (more are looked
// for on request), all with a score (see judge) at most `within` times the best one's
const ALTERNATIVE_LAYOUTS = { first: 8, within: 1.25 };

// With CONFIG.guideFit at 1, a layout leaving all of the guide shape empty would count as this
// many times longer again (one filling half of it, half as much)
const GUIDE_FIT_WEIGHT = 2;

// The best compact layout (see compactLayouts)
function compactLayout(textLines){
  return compactLayouts(textLines).layouts[0];
}

// The shape of a layout: the length of the tightest outline around everything drawn (its
// convex hull: an outline without dents), how much of the guide shape that outline fills (the
// smallest guide shape around the drawing, centred where the guide is), and how many stray
// words there are.
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

  let perimeter = 0, area = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length];
    perimeter += Math.hypot(x2 - x1, y2 - y1);
    area += (x1 * y2 - x2 * y1) / 2;
  }
  const shape = guideShape();
  const size = Math.max(0, ...hull.map(([x, y]) => shape.gauge(x, y)));
  const fill = size > 0 ? Math.min(1, Math.abs(area) / (shape.area * size * size)) : 1;

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
  return { perimeter, fill, strays: strayWords.size };
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
// Strokes
// =============================================================================

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
