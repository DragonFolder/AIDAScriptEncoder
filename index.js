// =============================================================================
// AIDAScript: turns the text in the textarea into an SVG drawing.
//
// Each line of text is drawn as a column, from top to bottom.
// Every letter is two strokes going out from its middle point, and letters are
// stacked so their strokes connect without crossing in the wrong places.
// Where each character goes is worked out in layout.js (loaded first); this file
// handles the page: the settings, drawing, the preview and the downloads.
//
// Contents:
//   1. Settings        – reading the settings panel, tabs, random colors, tooltips
//   6. Drawing         – turning shapes into SVG lines
//   7. Render          – runs on every keystroke
//      Zoom            – preview zoom buttons
//   8. Downloads       – SVG and PNG buttons, Copy image
//   9. Sharing         – Copy link, and the settings kept between visits
//  10. Alphabet        – the "How to read AIDAScript" letters
// (sections 2 to 5 are in layout.js)
// =============================================================================


// =============================================================================
// 1. Settings
// =============================================================================


const byId = id => document.getElementById(id);
const VERSION = new URL(document.currentScript.src).search;   // (the page's ?v=, for the worker too)

// Copy the values from the "Settings" panel into CONFIG.
// An empty or invalid number keeps the last valid value.
function readSettings(){
  const number = (id, min, current) => {
    const input = byId(id), n = parseFloat(input.value);
    const max = input.max === '' ? Infinity : +input.max;   // (the most index.html allows)
    return Number.isFinite(n) && n >= min ? Math.min(n, max) : current;
  };

  const padding = number('setPadding', 0, CONFIG.padding.top);
  CONFIG.padding = { top: padding, right: padding, bottom: padding, left: padding };
  CONFIG.lineSize = number('setLineSize', 1, CONFIG.lineSize);
  CONFIG.lineSpacing = number('setLineSpacing', 0, CONFIG.lineSpacing);
  CONFIG.maxLineLength = number('setMaxHeight', 1, CONFIG.maxLineLength);
  CONFIG.stroke.color = byId('setLineColor').value;
  CONFIG.background = byId('setBgColor').value;
  CONFIG.transparent = byId('setTransparent').checked;
  CONFIG.shape = byId('setShape').value;
  CONFIG.guideShape = byId('setGuideShape').value;
  CONFIG.guideRatio = number('setGuideRatio', 0.1, CONFIG.guideRatio);
  CONFIG.guideRotation = number('setGuideRotation', 0, CONFIG.guideRotation);
  CONFIG.guideFit = number('setGuideFit', 0, CONFIG.guideFit * 100) / 100;
  byId('guideRatioValue').textContent = CONFIG.guideRatio.toFixed(1) + ' : 1';
  byId('guideRotationValue').textContent = Math.round(CONFIG.guideRotation) + '°';
  byId('guideFitValue').textContent = CONFIG.guideFit == 0 ? 'Tightest' : Math.round(CONFIG.guideFit * 100) + '%';
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
  show('setGuideRatio', compact);
  show('setGuideRotation', compact);
  show('setGuideFit', compact);
  show('compactOptions', compact);    // extend free line ends, show line guides
  show('setColumnColours', compact);
  show('setSecondColor', compact && CONFIG.columnColours == 'alternate');
  show('setFrame', compact);
  show('frameColorPanel', framed);
  show('setFrameWidth', framed);
  byId('setFrameColor').classList.toggle('d-none', CONFIG.frameSameColor);
  byId('setBgColor').classList.toggle('d-none', CONFIG.transparent);
  byId(compact ? 'quickCompact' : 'quickRectangle').checked = true;
  if (compact) compactHintDone();   // (tried it: no need to suggest it any more)
  showCompactHint(!compact);
  byId('layoutPicker').hidden = !compact;

  // The Frame tab only for the compact shape (leaving it if it was open)
  byId('frameTab').classList.toggle('d-none', !compact);
  if (!compact && settingsTab == 'frame') showSettingsTab('shape');
}

// The Rectangle | Compact switch above the preview: the same as Settings → Shape
document.querySelectorAll('[name=quickShape]').forEach(radio => radio.onchange = () => {
  byId('setShape').value = radio.value;
  render();
});

// The hint under the preview suggesting the compact shape: shown with the rectangle shape until
// the compact shape has been tried once, or the hint closed. That's remembered in this browser
// (if it can't be, the hint just shows again next time).
const COMPACT_HINT_KEY = 'aidascript.compactHintDone';
function hintIsDone(){
  try { return localStorage.getItem(COMPACT_HINT_KEY) == '1'; } catch { return false; }
}
function compactHintDone(){
  try { localStorage.setItem(COMPACT_HINT_KEY, '1'); } catch {}
  showCompactHint(false);
}
function showCompactHint(wanted){
  byId('compactHint').classList.toggle('d-none', !wanted || hintIsDone());
}
byId('compactHintTry').onclick = () => {
  byId('setShape').value = 'compact';
  render();
};
byId('compactHintClose').onclick = compactHintDone;

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

// (the colors themselves are made by randomColors, in colors.js)
// Put a new set of random colors into the settings panel (render() shows them)
function pickRandomColors(){
  const { line, second, frame, background, name } = randomColors();
  byId('setLineColor').value = line;
  byId('setSecondColor').value = second;
  byId('setFrameColor').value = frame;   // ("Same as line color" stays as it is)
  byId('setBgColor').value = background;
  byId('randomColorsName').textContent = name;   // what was picked, e.g. "Triadic · muted · deep background"
}
byId('randomColors').onclick = () => { pickRandomColors(); render(); };

// "Surprise me": the compact shape with a random look: guide shape, its stretch and turn, how
// closely to follow it, column colors, frame and colors, and then a random one of the layouts
// found for it (picked when they're drawn, see renderCompact: they may still be on their way). The text, the sizes, the transparent
// background and the line end settings stay as they are. Plain choices (no stretch, no turn)
// come up half the time, so not every surprise is lopsided.
function surpriseMe(){
  const one = list => list[Math.floor(Math.random() * list.length)];
  const half = () => Math.random() < 0.5;
  byId('setShape').value = 'compact';
  byId('setGuideShape').value = one(['circle', 'rectangle', 'hexagon', 'diamond', 'triangle']);
  byId('setGuideRatio').value = half() ? 1 : one([0.6, 0.7, 0.8, 1.2, 1.4, 1.6, 1.8]);
  byId('setGuideRotation').value = half() ? 0 : one([15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]);
  byId('setGuideFit').value = one([0, 30, 60, 100]);
  byId('setColumnColours').value = one(['single', 'alternate']);
  byId('setFrame').value = one(['none', 'guide', 'guide', 'rectangle', 'blob']);
  byId('setFrameWidth').value = one([3, 5, 8]);
  byId('setFrameSameColor').checked = Math.random() < 0.6;
  pickRandomColors();
  randomLayoutWanted = true;
  render();
}
let randomLayoutWanted = false;   // (see surpriseMe; dropped when the text changes)
byId('surpriseMe').onclick = surpriseMe;

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
// (returns the element)
function drawLine(x1, y1, x2, y2, colour = CONFIG.stroke.color){
  return el('line', { x1, y1, x2, y2, stroke: colour, 'stroke-width': CONFIG.stroke.width, 'stroke-linecap': 'round' }, svg);
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
      const line = { x1: x + L*x1, y1: cy + L*y1, x2: x + L*x2, y2: cy + L*y2, punctuation, kind: null, char: i };
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
// (each line keeps its element, as `element`, for reading the drawing: see readingMap)
function drawLines(lines, dx = 0, dy = 0){
  for (const l of lines) l.element = drawLine(l.x1 + dx, l.y1 + dy, l.x2 + dx, l.y2 + dy, l.colour);
}

// The colour of the n-th column (counting only columns with something in them), see CONFIG.columnColours
function columnColour(n){
  return CONFIG.columnColours == 'alternate' && n % 2 == 1 ? CONFIG.secondColor : CONFIG.stroke.color;
}

// The 'guide' frame for the guide shapes (see frameAround; the plain circle and the upright
// rectangle have simpler ones there): the smallest such shape, stretched and turned like the
// guide, around the points, `away` clear of them. Its middle is found by narrowing down, across
// and then up and down a few times, where the shape needs to be smallest (the size needed is a
// convex function of the middle, so this finds the best one). A polygon is then pushed out by
// `away` side by side; an ellipse is made bigger until it's at least `away` clear everywhere.
function guideFrame(points, box, away, stroke){
  const shape = guideShape();
  const sizeAt = (cx, cy) => Math.max(...points.map(([x, y]) => shape.gauge(x - cx, y - cy)));
  const narrow = (low, high, f) => {
    for (let k = 0; k < 40; k++) {
      const a = low + (high - low) / 3, b = high - (high - low) / 3;
      if (f(a) < f(b)) high = b; else low = a;
    }
    return (low + high) / 2;
  };
  let cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  for (let round = 0; round < 3; round++) {
    cx = narrow(box.left, box.right, x => sizeAt(x, cy));
    cy = narrow(box.top, box.bottom, y => sizeAt(cx, y));
  }
  const size = sizeAt(cx, cy);

  if (shape.ellipse) {
    const grown = size + away / Math.min(...shape.ellipse);
    const [rx, ry] = shape.ellipse.map(v => v * grown);
    const t = shape.rotation * Math.PI / 180;
    const halfX = Math.hypot(rx * Math.cos(t), ry * Math.sin(t)), halfY = Math.hypot(rx * Math.sin(t), ry * Math.cos(t));
    return {
      left: cx - halfX - stroke/2, right: cx + halfX + stroke/2, top: cy - halfY - stroke/2, bottom: cy + halfY + stroke/2,
      draw: (dx, dy, attrs) => el('ellipse', { cx: cx + dx, cy: cy + dy, rx, ry,
        transform: `rotate(${shape.rotation} ${cx + dx} ${cy + dy})`, ...attrs }, svg),
    };
  }

  // Each side moved out by `away`: each corner moves along the sum of its two sides' outward
  // directions, far enough for both sides to be `away` further out
  let corners = shape.outline.map(([x, y]) => [cx + x * size, cy + y * size]);
  let area = 0;
  corners.forEach(([x1, y1], i) => { const [x2, y2] = corners[(i + 1) % corners.length]; area += x1 * y2 - x2 * y1; });
  if (area < 0) corners = corners.reverse();   // (clockwise on screen: each side's outside is to its left)
  const outward = corners.map(([x1, y1], i) => {
    const [x2, y2] = corners[(i + 1) % corners.length], length = Math.hypot(x2 - x1, y2 - y1);
    return [(y2 - y1) / length, -(x2 - x1) / length];
  });
  corners = corners.map(([x, y], i) => {
    const [ax, ay] = outward[(i + corners.length - 1) % corners.length], [bx, by] = outward[i];
    const k = away / (1 + ax * bx + ay * by);
    return [x + (ax + bx) * k, y + (ay + by) * k];
  });
  return {
    left: Math.min(...corners.map(p => p[0])) - stroke/2, right: Math.max(...corners.map(p => p[0])) + stroke/2,
    top: Math.min(...corners.map(p => p[1])) - stroke/2, bottom: Math.max(...corners.map(p => p[1])) + stroke/2,
    draw: (dx, dy, attrs) => el('polygon', { points: corners.map(([x, y]) => `${(x + dx).toFixed(2)},${(y + dy).toFixed(2)}`).join(' '), ...attrs }, svg),
  };
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
//   'guide': the guide shape, stretched and turned like the guide (the smallest one around the
//     drawing; an upright rectangle sits on the drawing's middle);
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
  const shape = guideShape();
  if (CONFIG.frame == 'guide' && CONFIG.guideShape == 'rectangle' && shape.rotation % 180 == 0) {
    // (turned half way round, it's the same rectangle the other way up)
    const ratio = shape.rotation == 0 ? CONFIG.guideRatio : 1 / CONFIG.guideRatio;
    const w = Math.max(halfW, halfH * ratio);
    return square(midX, midY, w, w / ratio);
  }
  const points = lines.flatMap(l => [[l.x1, l.y1], [l.x2, l.y2]]);
  if (CONFIG.frame == 'guide' && CONFIG.guideShape == 'circle' && CONFIG.guideRatio == 1) {
    const c = enclosingCircle(points);
    const r = c.r + away;
    return {
      left: c.x - r - stroke/2, right: c.x + r + stroke/2, top: c.y - r - stroke/2, bottom: c.y + r + stroke/2,
      draw: (dx, dy, attrs) => el('circle', { cx: c.x + dx, cy: c.y + dy, r, ...attrs }, svg),
    };
  }
  if (CONFIG.frame == 'guide') return guideFrame(points, box, away, stroke);

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

// =============================================================================
// 7. Render
// =============================================================================

// -----------------------------------------------------------------------------
// Compact layouts in the background
// -----------------------------------------------------------------------------

// The compact layout can take a while on long text, so it runs in a background worker
// (layout-worker.js) and the page stays responsive: the last drawing stays in the preview,
// marked "Arranging…", until the new layouts arrive. A request that's no longer wanted (the
// text changed again) is dropped by restarting the worker. Without a worker (some browsers
// don't allow one for a page opened straight from a file), the layout runs here instead.

// The layouts for the current text and settings, kept until either changes, so stepping
// through them (or changing a colour) doesn't lay the text out again.
// `more` (without a worker only) looks for another; `exhausted`: none was left to find.
let layoutCache = { key: null, layouts: [], more: () => false, exhausted: true };
let layoutChoice = 0;   // which of them is shown

let layoutWorker = null;
let workerFailed = false;       // no worker: lay out on the page
let workerFailures = 0;         // how many times in a row a worker failed (see startWorker)
let pending = null;             // what the worker is working on: { key, type, started }
let lastLayoutTime = 0;         // how long the last layout took (see scheduleRender)

// A worker can fail now and then without anything being wrong (restarted in quick succession,
// say, it can fail to load layout.js), so it's simply started again; only after this many
// failures in a row is the layout done on the page instead
const WORKER_RETRIES = 3;

function startWorker(){
  let worker;
  try {
    worker = new Worker('layout-worker.js' + VERSION);
  } catch {   // (not allowed at all, e.g. for a page opened straight from a file)
    workerFailed = true;
    return;
  }
  layoutWorker = worker;
  worker.onmessage = ({ data }) => { workerFailures = 0; workerReply(data); };
  worker.onerror = event => {
    event.preventDefault();
    worker.terminate();
    if (worker != layoutWorker) return;   // (one already replaced: nothing to do)
    layoutWorker = null;
    pending = null;
    showBusy(false);
    if (++workerFailures >= WORKER_RETRIES) workerFailed = true;   // (from now on, on the page)
    layoutCache.key = null;   // (so the layouts are asked for again)
    render();
  };
}

// Ask the worker for something (see layout-worker.js), dropping whatever it was still doing
function askWorker(message){
  if (pending) { layoutWorker.terminate(); layoutWorker = null; }
  if (!layoutWorker) startWorker();
  if (workerFailed) return false;
  pending = { key: message.key, type: message.type, started: performance.now() };
  layoutWorker.postMessage(message);
  showBusy(true);
  return true;
}

function workerReply(data){
  if (!pending || data.key != pending.key || data.type != pending.type) return;   // (no longer wanted)
  lastLayoutTime = performance.now() - pending.started;
  pending = null;
  showBusy(false);
  if (data.type == 'layouts') {
    layoutCache = { key: data.key, layouts: data.layouts, more: null, exhausted: false };
    layoutChoice = 0;
  } else if (data.layout) {
    layoutCache.layouts.push(data.layout);
    layoutChoice = layoutCache.layouts.length - 1;
  } else {
    layoutCache.exhausted = true;
  }
  render();
}

// Are the layouts for this text and the current settings ready? If not, they're asked for
// (render() runs again when they arrive), or, without a worker, made right away.
function layoutsReady(textLines){
  const config = { lineSize: CONFIG.lineSize, stroke: { ...CONFIG.stroke }, guideShape: CONFIG.guideShape,
                   guideRatio: CONFIG.guideRatio, guideRotation: CONFIG.guideRotation,
                   guideFit: CONFIG.guideFit };   // (what the layout depends on)
  const key = JSON.stringify([textLines, config]);
  if (key == layoutCache.key) return true;
  if (pending?.key == key && pending.type == 'layouts') return false;   // (already on its way)
  if (!workerFailed && askWorker({ type: 'layouts', key, textLines, config })) return false;

  const started = performance.now();
  layoutCache = { key, ...compactLayouts(textLines), exhausted: false };
  layoutChoice = 0;
  lastLayoutTime = performance.now() - started;
  return true;
}

// While the worker works: "Arranging…" in the preview's header, the old drawing faded, and
// no downloads (they would be of the old drawing)
function showBusy(busy){
  byId('layoutBusy').hidden = !busy;
  preview.classList.toggle('busy', busy);
  byId('dlSvg').disabled = busy;
  byId('dlPng').disabled = busy;
  byId('copyImage').disabled = busy;
  byId('layoutNext').disabled = busy || byId('layoutNext').disabled;
}


// -----------------------------------------------------------------------------
// Drawing it all
// -----------------------------------------------------------------------------

// While typing, wait for a short pause before drawing again if drawing (or laying out) is slow
// (long text in the compact shape), so keystrokes don't pile up behind each other
let lastRenderTime = 0;
let renderTimer = null;
function scheduleRender(){
  clearTimeout(renderTimer);
  const slow = lastRenderTime > 50 || (CONFIG.shape == 'compact' && lastLayoutTime > 50);
  renderTimer = setTimeout(render, slow ? 150 : 0);
}

function render(){
  const started = performance.now();
  readSettings();
  const textLines = drawableText(input.value).split('\n');   // (characters with no shape drawn as spaces)
  if (CONFIG.shape == 'compact' && !layoutsReady(textLines)) return;   // (the old drawing stays meanwhile)
  if (CONFIG.shape != 'compact' && pending) {   // (a compact layout that's no longer wanted)
    layoutWorker.terminate();
    layoutWorker = null;
    pending = null;
    showBusy(false);
  }

  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  preview.replaceChildren(svg);

  const [w, h] = CONFIG.shape == 'compact' ? renderCompact(textLines) : renderRectangle(textLines);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Background: added after measuring (so it doesn't count as part of the drawing),
  // and as the first element (so it sits behind the lines). Part of the SVG, so downloads keep it.
  // With a transparent background there's none, and the preview shows a checkerboard instead.
  if (!CONFIG.transparent) {
    const background = el('rect', { x: 0, y: 0, width: w, height: h, fill: CONFIG.background });
    svg.insertBefore(background, svg.firstChild);
  }
  svg.classList.toggle('transparent', CONFIG.transparent);

  // What it says, for screen readers (downloads get it as a title instead, see svgString)
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', drawingText() ? 'AIDAScript: ' + drawingText() : 'AIDAScript (empty)');
  hideReading();

  applyZoom();   // the new drawing keeps the current zoom
  lastRenderTime = performance.now() - started;
  afterRender();
}

// Columns from left to right, each wrapped at the maximum height. Returns the image size.
function renderRectangle(textLines){
  const { lineSize, lineSpacing, padding } = CONFIG;
  let column = 0;   // counts the columns actually drawn, including wrapped ones
  const lines = [];

  const columns = [];
  for (const textLine of textLines) {
    for (const chars of wrapLine(textLine)) {
      const x = padding.left + lineSize + (lineSize*2 + lineSpacing) * column;
      const positions = placeLine(chars);
      const own = columnLines(chars, positions, x, padding.top);
      for (const line of own) line.column = column;
      lines.push(...own);
      columns.push({ chars, positions, x, y: padding.top });
      column++;
    }
  }
  drawLines(lines);   // (free line ends are only extended in the compact shape)
  readingMap(columns, lines);

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
  const layouts = layoutCache.layouts;   // (ready: see layoutsReady)
  if (linkLayoutWanted !== null) {   // (a shared link: the layout it was made with)
    layoutChoice = linkLayoutWanted;
    linkLayoutWanted = null;
  }
  if (randomLayoutWanted) {   // ("Surprise me": any of the layouts found, not just the best)
    layoutChoice = Math.floor(Math.random() * layouts.length);
    randomLayoutWanted = false;
  }
  layoutChoice = Math.min(layoutChoice, layouts.length - 1);
  showLayoutChoice(layouts.length);
  const columns = layouts[layoutChoice];

  // Each column's lines, in its colour
  const lines = [];
  let filled = 0;
  columns.forEach((c, column) => {
    const own = columnLines(c.chars, c.positions, c.x, c.y);
    if (own.length == 0) return;
    const colour = columnColour(filled++);
    for (const line of own) { line.colour = colour; line.column = column; }
    lines.push(...own);
  });
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
  readingMap(columns, lines, dx, dy);
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
  byId('layoutNext').disabled = (layoutChoice >= count - 1 && layoutCache.exhausted) || !!pending;
}
byId('layoutPrev').onclick = () => { layoutChoice--; render(); };
byId('layoutNext').onclick = () => {
  if (layoutChoice < layoutCache.layouts.length - 1) {
    layoutChoice++;
    render();
  } else if (!layoutCache.more) {   // (made by the worker: it looks for another, see workerReply)
    if (!askWorker({ type: 'more', key: layoutCache.key })) {   // (the worker has stopped working)
      layoutCache.exhausted = true;
      showLayoutChoice(layoutCache.layouts.length);
    }
  } else if (layoutCache.more()) {
    layoutChoice++;
    render();
  } else {
    layoutCache.exhausted = true;
    showLayoutChoice(layoutCache.layouts.length);
  }
};


// -----------------------------------------------------------------------------
// Reading the drawing
// -----------------------------------------------------------------------------

// Pointing at the drawing (or tapping it) shows what it says: the nearest letter's word stays
// dark while the rest fades, the letter itself turns the accent colour, and a label beside the
// pointer shows that column's text with the word in the accent colour and the letter as a block of it.
// `reading` holds every drawn character of the current drawing (made again on every render):
// { x, y } (its middle, in the drawing's pixels), its column's characters and its place in
// them, where its word starts and ends, and the elements of its lines.
let reading = [];
function readingMap(columns, lines, dx = 0, dy = 0){
  const L = CONFIG.lineSize;
  const elements = new Map();   // "column,char" -> its lines' elements
  for (const line of lines) {
    const key = line.column + ',' + line.char;
    if (!elements.has(key)) elements.set(key, []);
    elements.get(key).push(line.element);
  }
  reading = [];
  columns.forEach((c, column) => {
    c.chars.forEach((ch, i) => {
      if (ch == ' ') return;
      let start = i, end = i;
      while (start > 0 && c.chars[start - 1] != ' ') start--;
      while (end < c.chars.length - 1 && c.chars[end + 1] != ' ') end++;
      reading.push({ x: c.x + dx, y: c.y + dy + c.positions[i] * L, chars: c.chars, column, index: i, start, end,
                     elements: elements.get(column + ',' + i) ?? [] });
    });
  });
}

const readingLabel = document.createElement('div');
readingLabel.className = 'reading-label';
readingLabel.setAttribute('aria-hidden', 'true');   // (screen readers get the whole text instead)
document.body.appendChild(readingLabel);
let readingNow = null;   // the character being shown

function hideReading(){
  readingNow = null;
  readingLabel.style.display = 'none';
  if (svg) svg.classList.remove('reading');
  preview.querySelectorAll('.reading-overlay').forEach(overlay => overlay.remove());
  preview.querySelectorAll('.reading-word').forEach(e => e.classList.remove('reading-word'));
}

function showReading(event){
  if (!svg || reading.length == 0) return hideReading();
  // The pointer, in the drawing's own pixels (whatever the zoom)
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  let nearest = null, distance = CONFIG.lineSize * 1.2;   // (not too far from any letter)
  for (const item of reading) {
    const d = Math.hypot(item.x - point.x, item.y - point.y);
    if (d < distance) { nearest = item; distance = d; }
  }
  if (!nearest) return hideReading();

  if (nearest != readingNow) {
    hideReading();
    readingNow = nearest;
    svg.classList.add('reading');
    for (const item of reading) {
      if (item.column == nearest.column && item.index >= nearest.start && item.index <= nearest.end) {
        item.elements.forEach(e => e.classList.add('reading-word'));
      }
    }
    // The letter's lines drawn again on top, in the accent colour: where a letter's S lies on the
    // next letter's N, that next letter's line is drawn over it, and would hide part of the letter
    const overlay = el('g', { class: 'reading-overlay' }, svg);
    for (const e of nearest.elements) {
      const copy = e.cloneNode();
      copy.setAttribute('class', 'reading-letter');
      overlay.appendChild(copy);
    }

    // The label: the column's text, the word marked, the letter in a block of its own
    const text = nearest.chars.map(readableChar).join('');   // (see TICKED in layout.js)
    const word = document.createElement('mark');
    const letter = document.createElement('b');
    letter.textContent = text[nearest.index];
    word.append(text.slice(nearest.start, nearest.index), letter, text.slice(nearest.index + 1, nearest.end + 1));
    readingLabel.replaceChildren(text.slice(0, nearest.start).trimStart(), word, text.slice(nearest.end + 1).trimEnd());
    readingLabel.style.display = 'block';
  }
  // Beside the column (words run downwards, so this keeps the whole word in view): to its right,
  // or to its left if there's no room, level with the pointer, and kept on screen
  const width = readingLabel.offsetWidth, height = readingLabel.offsetHeight;
  const toScreen = x => new DOMPoint(x, readingNow.y).matrixTransform(svg.getScreenCTM()).x;
  const reach = CONFIG.lineSize + CONFIG.stroke.width;   // (how far a column's strokes reach sideways)
  const screenWidth = document.documentElement.clientWidth;
  let left = toScreen(readingNow.x + reach) + 10;
  if (left + width > screenWidth - 8) left = toScreen(readingNow.x - reach) - 10 - width;
  readingLabel.style.left = Math.min(Math.max(8, left), screenWidth - width - 8) + 'px';
  readingLabel.style.top = Math.min(Math.max(8, event.clientY - height / 2), document.documentElement.clientHeight - height - 8) + 'px';
}

preview.addEventListener('pointermove', showReading);
preview.addEventListener('pointerdown', showReading);   // (a tap, on a touch screen)
preview.addEventListener('pointerleave', event => { if (event.pointerType == 'mouse') hideReading(); });
document.addEventListener('pointerdown', event => { if (!preview.contains(event.target)) hideReading(); });
addEventListener('scroll', hideReading, { passive: true });


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

// (saving a file, on a phone too: see saveFile in save.js)

// The drawing as SVG text, at its real size (without the preview's zoom)
// The text that's drawn, as typed (blank lines and spaces at the ends left out)
function drawingText(){
  return input.value.split('\n').map(line => line.trim()).filter(line => line).join('\n');
}

// The drawing as SVG text, at its real size (without the preview's zoom), with the text it
// says as its title (shown by many viewers, and read by screen readers and search tools)
function svgString(){
  const copy = svg.cloneNode(true);
  copy.removeAttribute('style');
  copy.removeAttribute('class');   // (the preview's checkerboard, for a transparent background)
  copy.querySelectorAll('.guide, .reading-overlay').forEach(part => part.remove());   // the line guides and the reading highlight are preview only
  copy.querySelectorAll('[class]').forEach(part => part.removeAttribute('class'));   // (reading highlights)
  if (drawingText()) {
    const title = document.createElementNS(NS, 'title');
    title.textContent = drawingText();
    copy.insertBefore(title, copy.firstChild);   // (a title goes first)
  }
  return new XMLSerializer().serializeToString(copy);
}

// A PNG file with `text` written into it as its description (an iTXt "Description" chunk, which
// image tools can read; the picture itself is unchanged), right after its header chunk
async function pngWithText(blob, text){
  const png = new Uint8Array(await blob.arrayBuffer());
  const bytes = s => new TextEncoder().encode(s);
  // iTXt: keyword, 0, not compressed (0), method 0, no language, 0, no translated keyword, 0, the text (UTF-8)
  const data = new Uint8Array([...bytes('Description'), 0, 0, 0, 0, 0, ...bytes(text)]);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(bytes('iTXt'), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  const afterHeader = 8 + 25;   // the 8-byte signature, then IHDR (13 bytes of data + 12)
  return new Blob([png.subarray(0, afterHeader), chunk, png.subarray(afterHeader)], { type: 'image/png' });
}

// The CRC-32 a PNG chunk ends with
function crc32(data){
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

byId('dlSvg').onclick = () =>
  saveFile(new Blob([svgString()], { type: 'image/svg+xml' }), 'image.svg');

// The drawing as a PNG, twice its real size, with its text inside (see pngWithText)
function pngBlob(){
  const scale = 2;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = svg.width.baseVal.value * scale;
      c.height = svg.height.baseVal.value * scale;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(async b => b ? resolve(drawingText() ? await pngWithText(b, drawingText()) : b) : reject(), 'image/png');
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString());
  });
}
// (made ahead after every drawing, so a click can save it at once: see ReadyPng in save.js)
const png = new ReadyPng(pngBlob);
byId('dlPng').onclick = async () => saveFile(png.ready(svgString()) ?? await pngBlob(), 'image.png');

// A button's label for a moment (to say how something went), then back
function flash(button, text){
  clearTimeout(button.flashTimer);
  button.dataset.label ??= button.textContent;
  button.textContent = text;
  button.flashTimer = setTimeout(() => { button.textContent = button.dataset.label; }, 1600);
}

// "Copy image": the PNG on the clipboard, to paste anywhere (hidden where the browser can't do that).
// (The clipboard is handed a promise of the image, so the copy still counts as part of the click.)
byId('copyImage').hidden = !CAN_COPY;
byId('copyImage').onclick = () => {
  const ready = png.ready(svgString());
  copyPng(ready ? Promise.resolve(ready) : pngBlob(), text => flash(byId('copyImage'), text));
};

input.addEventListener('input', () => {
  randomLayoutWanted = false;   // (a surprise is for the text it was asked for)
  linkLayoutWanted = null;      // (and so is a shared link's layout)
  scheduleRender();
});

const settings = byId('settings');
settings.addEventListener('input', scheduleRender);
settings.addEventListener('reset', () => setTimeout(render));   // wait until the form has put the defaults back


// =============================================================================
// 9. Sharing and remembering
// =============================================================================

// A drawing as a short piece of text: the text, every setting that isn't at its default (by name:
// the setting's id without "set", e.g. guideShape), and which layout is shown (counting from 1,
// only when it isn't the first). It's put after the # of a link ("Copy link"), which browsers
// never send to the server; the settings alone are also kept in this browser between visits.
// Whatever is read back is checked first: only known settings, and only sensible values.

const SETTING_INPUTS = [...document.querySelectorAll('#settings [id^="set"]')];
const settingName = input => input.id[3].toLowerCase() + input.id.slice(4);
// (a list's default is the option marked selected in index.html, or else its first)
const defaultOption = select => [...select.options].find(option => option.defaultSelected) ?? select.options[0];
const isDefault = input => input.type == 'checkbox' ? input.checked == input.defaultChecked
                         : input.tagName == 'SELECT' ? input.value == defaultOption(input)?.value
                         : input.value == input.defaultValue;

// The settings that aren't at their defaults, as { name: value } (colors without their #)
function changedSettings(){
  const changed = {};
  for (const input of SETTING_INPUTS) {
    if (isDefault(input)) continue;
    changed[settingName(input)] = input.type == 'checkbox' ? (input.checked ? '1' : '0')
                                : input.type == 'color' ? input.value.slice(1) : input.value;
  }
  return changed;
}

// Put settings ({ name: value }, from a link or from this browser) into the settings panel,
// leaving out anything unknown or not sensible
function applySettings(values){
  for (const input of SETTING_INPUTS) {
    const value = values[settingName(input)];
    if (typeof value != 'string') continue;
    if (input.type == 'checkbox') {
      if (value == '1' || value == '0') input.checked = value == '1';
    } else if (input.type == 'color') {
      if (/^[0-9a-fA-F]{6}$/.test(value)) input.value = '#' + value.toLowerCase();
    } else if (input.tagName == 'SELECT') {
      if ([...input.options].some(option => option.value == value)) input.value = value;
    } else {   // a number, or a slider: within its limits
      const n = parseFloat(value);
      const low = input.min === '' ? -Infinity : +input.min, high = input.max === '' ? Infinity : +input.max;
      if (Number.isFinite(n)) input.value = Math.min(Math.max(n, low), high);
    }
  }
}

// The current drawing, as a link's part after the #
function shareText(){
  const parts = new URLSearchParams();
  if (input.value.trim()) parts.set('text', input.value);
  for (const [name, value] of Object.entries(changedSettings())) parts.set(name, value);
  if (byId('setShape').value == 'compact' && layoutChoice > 0) parts.set('layout', layoutChoice + 1);
  return parts.toString();
}

// "Copy link": a link to this drawing, on the clipboard (and in the address bar, to copy from there
// if the clipboard isn't allowed)
let linkShown = null;   // the link part now in the address bar (dropped once the drawing changes)
byId('copyLink').onclick = async () => {
  linkShown = shareText();
  history.replaceState(null, '', location.pathname + location.search + '#' + linkShown);
  try {
    await navigator.clipboard.writeText(location.href);
    flash(byId('copyLink'), 'Link copied!');
  } catch {
    flash(byId('copyLink'), 'Copy it from the address bar');
  }
};

// After every render: remember the settings, and take the link out of the address bar once the
// drawing no longer matches it (so a reload doesn't undo what was changed since)
const SETTINGS_KEY = 'aidascript.settings';
function afterRender(){
  png.prepare(svg ? svgString() : null);
  try {
    const changed = changedSettings();
    if (Object.keys(changed).length) localStorage.setItem(SETTINGS_KEY, JSON.stringify(changed));
    else localStorage.removeItem(SETTINGS_KEY);
  } catch {}   // (not allowed to remember: it just won't)
  if (location.hash && linkShown !== null && linkLayoutWanted === null && shareText() != linkShown) {
    history.replaceState(null, '', location.pathname + location.search);
    linkShown = null;
  }
}

// On opening the page: the remembered settings, then a link's drawing (which wins)
let linkLayoutWanted = null;   // (a link's layout, picked once the layouts are ready: see renderCompact)
function restore(){
  try { applySettings(JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}); } catch {}
  if (location.hash.length > 1) {
    const parts = new URLSearchParams(location.hash.slice(1));
    const values = Object.fromEntries(parts);
    if (parts.has('text') || Object.keys(values).length) {
      // a link describes the whole drawing: anything it leaves out is at its default
      for (const input of SETTING_INPUTS) {
        if (input.type == 'checkbox') input.checked = input.defaultChecked;
        else if (input.tagName == 'SELECT') input.value = defaultOption(input)?.value ?? input.value;
        else input.value = input.defaultValue;
      }
      applySettings(values);
      input.value = (values.text ?? '').slice(0, 5000);   // (a sensible limit for a link)
      const layout = parseInt(values.layout);
      if (layout > 1) linkLayoutWanted = Math.min(layout - 1, 50);
      linkShown = location.hash.slice(1);
    }
  }
}


// =============================================================================
// 10. Alphabet
// =============================================================================

// "How to read AIDAScript": every letter, digit and punctuation mark as a small tile, drawn from the
// LETTERS, DIGITS and PUNCTUATION tables (so it always matches the drawing), in the text color of
// the tile. Clicking a letter or a digit types it into the text box.
function alphabetTile(ch, tag, label = ch){
  const tile = document.createElement(tag);
  tile.className = 'alphabet-tile';
  const lines = characterSegments(ch, undefined).map(([x1, y1, x2, y2]) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('');
  tile.innerHTML = `<svg viewBox="-1.3 -1.3 2.6 2.6" aria-hidden="true">` +
    `<circle r="0.07" fill="currentColor" opacity="0.35"/>` +
    `<g stroke="currentColor" stroke-width="0.25" stroke-linecap="round">${lines}</g></svg><span></span>`;
  tile.querySelector('span').textContent = label;
  return tile;
}

// A tile that types its character where the cursor is
function typingTile(ch){
  const tile = alphabetTile(ch, 'button');
  tile.type = 'button';
  tile.title = `Type ${ch}`;
  tile.onclick = () => {
    input.focus();
    input.setRangeText(ch, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return tile;
}

// The punctuation tiles, in this order, with what each one is for (the quote marks have an
// opening and a closing shape: see quoteMarks in layout.js)
const PUNCTUATION_TILES = [
  ['.', '.', 'Period'],
  [',', ',', 'Comma'],
  ["'", "'", "Apostrophe (don't), or an opening '"],
  ['’', "…'", "A closing '"],
  ['“', '"', 'An opening "'],
  ['”', '…"', 'A closing "'],
  ['?', '?', 'Question mark'],
  ['!', '!', 'Exclamation mark'],
  ['-', '-', 'Hyphen or dash (also – and —)'],
  [':', ':', 'Colon'],
  [';', ';', 'Semicolon'],
  ['(', '(', 'An opening parenthesis'],
  [')', ')', 'A closing parenthesis'],
  ['/', '/', 'Slash'],
];

function showAlphabet(){
  for (const ch of Object.keys(LETTERS)) byId('alphabetLetters').append(typingTile(ch));
  for (const ch of '1234567890') byId('alphabetDigits').append(typingTile(ch));
  for (const [ch, label, title] of PUNCTUATION_TILES) {
    const tile = alphabetTile(ch, 'div', label);
    tile.title = title;
    byId('alphabetPunctuation').append(tile);
  }
}

showAlphabet();
restore();
render();
