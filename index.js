// =============================================================================
// AIDAScript: turns the text in the textarea into an SVG drawing.
//
// Each line of text is drawn as a column, from top to bottom.
// Every letter is two strokes going out from its middle point, and letters are
// stacked so their strokes connect without crossing in the wrong places.
//
// Contents:
//   1. Settings
//   2. Shapes        – what each character looks like
//   3. Spacing rules – how far below the previous character each one goes
//   4. Layout        – placing a whole line, and wrapping long lines
//   5. Drawing       – turning shapes into SVG lines
//   6. Render        – runs on every keystroke
//      Zoom          – preview zoom buttons
//   7. Downloads     – SVG and PNG buttons
//
// Units: the shape and spacing code works in "lineSizes" (1 = the length of one
// full stroke). Only the drawing code converts to pixels.
// =============================================================================


// =============================================================================
// 1. Settings
// =============================================================================

// Defaults. The "Advanced settings" panel overwrites lineSize, lineSpacing, maxLineLength,
// padding, stroke.color and background before every render (see readSettings).
const CONFIG = {
  lineSize: 20,          // length of one full stroke, in pixels
  lineSpacing: 10,       // extra gap between two columns of text, in pixels
  maxLineLength: 400,    // how far down a column may reach (from the top padding) before wrapping, in pixels
  padding: { top: 30, right: 30, bottom: 30, left: 30 },
  stroke: { color: '#000000', width: 5 },
  background: '#ffffff',
};

// Copy the values from the "Advanced settings" panel into CONFIG.
// An empty or invalid number keeps the last valid value.
function readSettings(){
  const value = id => document.getElementById(id).value;
  const number = (id, min, current) => {
    const n = parseFloat(value(id));
    return Number.isFinite(n) && n >= min ? n : current;
  };

  const padding = number('setPadding', 0, CONFIG.padding.top);
  CONFIG.padding = { top: padding, right: padding, bottom: padding, left: padding };
  CONFIG.lineSize = number('setLineSize', 1, CONFIG.lineSize);
  CONFIG.lineSpacing = number('setLineSpacing', 0, CONFIG.lineSpacing);
  CONFIG.maxLineLength = number('setMaxHeight', 1, CONFIG.maxLineLength);
  CONFIG.stroke.color = value('setLineColor');
  CONFIG.background = value('setBgColor');
}

const NS = 'http://www.w3.org/2000/svg';
const input = document.getElementById('input');
const preview = document.getElementById('preview');
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
    // because drawOverlapMarker adds an extra line to show the overlap (and the X crossings are allowed anyway)
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
// from the bottom of the previous word's last character to the top of this one
function wordGapY(previousCh, previousY, ch, spaces){
  return previousY + letterBottom(previousCh) + spaces - letterTop(ch);
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

// The position of every character in one line
function placeLine(chars){
  const positions = [];
  for (let i = 0; i < chars.length; i++) {
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
// 5. Drawing
//
// x and y here are in pixels: the middle of the character being drawn.
// =============================================================================

// Create an SVG element with the given attributes, and add it to `parent`
function el(tag, attrs = {}, parent){
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// One stroke, in pixels
function drawLine(x1, y1, x2, y2){
  el('line', { x1, y1, x2, y2, stroke: CONFIG.stroke.color, 'stroke-width': CONFIG.stroke.width, 'stroke-linecap': 'round' }, svg);
}

function drawCharacter(ch, previousCh, x, y){
  if (isPunctuation(ch)) {
    drawPunctuation(ch, x, y);
    return;
  }
  drawOverlapMarker(getCharShape(previousCh), getCharShape(ch), x, y);
  drawLetter(getCharShape(ch), x, y);
}

function drawPunctuation(ch, x, y){
  const L = CONFIG.lineSize;
  for (const [x1, y1, x2, y2] of PUNCTUATION[ch]) {
    drawLine(x + L*x1, y + L*y1, x + L*x2, y + L*y2);
  }
}

// A letter: its two strokes, from the middle outwards
function drawLetter(shape, x, y){
  const L = CONFIG.lineSize;
  for (const [dx, dy] of shape) {
    drawLine(x, y, x + L*dx, y + L*dy);
  }
}

// When the previous letter's S and this letter's N lie on top of each other, draw an extra
// line half a lineSize beside them (from the N tip down to the middle) to show the overlap.
function drawOverlapMarker(previousShape, currentShape, x, y){
  if (!(previousShape.includes(S) && currentShape.includes(N))) return;

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

  const L = CONFIG.lineSize;
  drawLine(x + L*xTop, y - L, x + L*xBottom, y);
}


// =============================================================================
// 6. Render
// =============================================================================

function render(){
  readSettings();
  const { lineSize, lineSpacing, padding } = CONFIG;
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);

  let column = 0;   // counts the columns actually drawn, including wrapped ones

  for (const textLine of input.value.split('\n')) {
    for (const chars of wrapLine(textLine)) {
      const positions = placeLine(chars);
      const x = padding.left + lineSize + (lineSize*2 + lineSpacing) * column;

      chars.forEach((ch, i) => {
        if (ch == ' ') return;   // spaces are just a gap: nothing to draw
        const y = padding.top + positions[i] * lineSize;
        drawCharacter(ch, chars[i - 1], x, y);
      });
      column++;
    }
  }

  // Size the SVG to fit the drawing plus padding. Measure after it's in the page:
  // getBBox() covers every element inside the SVG.
  preview.replaceChildren(svg);
  const box = svg.getBBox();
  const w = Math.ceil(Math.max(box.x + box.width + padding.right, padding.left + padding.right));
  const h = Math.ceil(Math.max(box.y + box.height + padding.bottom, padding.top + padding.bottom));
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Background: added after measuring (so it doesn't count as part of the drawing),
  // and as the first element (so it sits behind the lines). Part of the SVG, so downloads keep it.
  const background = el('rect', { x: 0, y: 0, width: w, height: h, fill: CONFIG.background });
  svg.insertBefore(background, svg.firstChild);

  applyZoom();   // the new drawing keeps the current zoom
}


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

  document.getElementById('zoomReset').textContent = Math.round(zoom * 100) + '%';
  document.getElementById('zoomOut').disabled = zoom == ZOOM_LEVELS[0];
  document.getElementById('zoomIn').disabled = zoom == ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
}

// Move one zoom level in or out (+1 or -1)
function changeZoom(direction){
  const index = ZOOM_LEVELS.indexOf(zoom) + direction;
  zoom = ZOOM_LEVELS[Math.min(Math.max(index, 0), ZOOM_LEVELS.length - 1)];
  applyZoom();
}

document.getElementById('zoomIn').onclick = () => changeZoom(+1);
document.getElementById('zoomOut').onclick = () => changeZoom(-1);
document.getElementById('zoomReset').onclick = () => { zoom = 1; applyZoom(); };


// =============================================================================
// 7. Downloads
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
  return new XMLSerializer().serializeToString(copy);
}

document.getElementById('dlSvg').onclick = () =>
  download(new Blob([svgString()], { type: 'image/svg+xml' }), 'image.svg');

document.getElementById('dlPng').onclick = () => {
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

input.addEventListener('input', render);

const settings = document.getElementById('settings');
settings.addEventListener('input', render);
settings.addEventListener('reset', () => setTimeout(render));   // wait until the form has put the defaults back

render();
