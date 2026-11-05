// =============================================================================
// AIDAScript decoder: reads the text back out of a picture of AIDAScript.
//
// For now it reads the rectangle shape (plain columns side by side), as the page draws it, in
// any size: a downloaded PNG or SVG, a screenshot, a picture someone sent. It doesn't need the
// settings the picture was made with.
//
// How it works: rather than undoing the spacing rules, it lets the encoder (layout.js, loaded
// first) do the placing. A column is read from the top down: at each step every character is
// tried after the ones read so far, placed exactly where the encoder would put it, and kept only
// if all of its lines lie on ink. Once a stretch of the column can't be reached by any character
// still to come, all of its ink must have been explained; branches that leave ink unexplained
// are dropped. A column is read when every bit of its ink is explained. So whatever the encoder
// can tell apart, the decoder can too, and a new spacing rule needs no change here.
//
// The sizes (the line size, where each column's middle is, where the top is) are first guessed
// from the picture, then fitted to what was read so far, and the column read again, until it's
// read in full (see readColumn).
//
// No drawing and nothing on the page here (index.js turns an image into pixels), so the tests
// can run it too.
//
// Contents:
//   Ink              – which pixels are ink, and how thick the lines are
//   Reading a column – the search
//   Fitting          – the line size and position, from what's been read
//   The whole picture
// =============================================================================


// =============================================================================
// Ink
// =============================================================================

// Which pixels of an RGBA image (as in ImageData) are ink: a Uint8Array of 0 and 1.
// The background is the colour most of the picture's border has (or no colour, if the border is
// see-through); ink is whatever differs from it enough (see inkThreshold).
function inkMask(rgba, width, height){
  const ink = new Uint8Array(width * height);
  const border = [];
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) border.push(y * width, y * width + width - 1);

  const seeThrough = border.filter(i => rgba[i*4 + 3] < 128).length > border.length / 2;
  if (seeThrough) {
    for (let i = 0; i < ink.length; i++) ink[i] = rgba[i*4 + 3] >= 128 ? 1 : 0;
    return ink;
  }

  // The most common border colour (counted roughly, so slight noise doesn't split it)
  const counts = new Map();
  for (const i of border) {
    const key = (rgba[i*4] >> 3) << 10 | (rgba[i*4 + 1] >> 3) << 5 | rgba[i*4 + 2] >> 3;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const key = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const sameKey = i => ((rgba[i*4] >> 3) << 10 | (rgba[i*4 + 1] >> 3) << 5 | rgba[i*4 + 2] >> 3) == key;
  const background = [0, 1, 2].map(c => {
    const values = border.filter(sameKey).map(i => rgba[i*4 + c]);
    return values.reduce((a, b) => a + b, 0) / values.length;
  });

  // How different each pixel is from the background (see-through pixels count as background)
  const difference = new Float32Array(width * height);
  let most = 0;
  for (let i = 0; i < difference.length; i++) {
    const alpha = rgba[i*4 + 3] / 255;
    let sum = 0;
    for (let c = 0; c < 3; c++) {
      const value = rgba[i*4 + c] * alpha + background[c] * (1 - alpha);
      sum += (value - background[c]) ** 2;
    }
    difference[i] = Math.sqrt(sum);
    most = Math.max(most, difference[i]);
  }
  if (most < 40) return ink;   // (all background: nothing drawn)
  const threshold = inkThreshold(difference, most);
  for (let i = 0; i < ink.length; i++) ink[i] = difference[i] > threshold ? 1 : 0;
  return ink;
}

// How different from the background a pixel must be to be ink, from how different they all are
// (`difference`, up to `most`). First the split between the background and everything else that
// keeps each side as alike as it can (Otsu's method). Lines drawn with a glow around them (or a
// shadow, or a blurred edge) then still have their glow on the ink side: if that side splits again
// into two clear groups, with few pixels between, only the more different one (the lines' cores)
// is ink. In a plain picture the ink is one group, and this changes nothing.
function inkThreshold(difference, most){
  const BINS = 256;
  const counts = new Float64Array(BINS);
  for (const d of difference) counts[Math.min(BINS - 1, Math.floor(d / most * BINS))]++;
  // Otsu's split of bins from..to-1: the bin where the upper part starts
  const otsu = (from, to) => {
    let total = 0, sum = 0;
    for (let k = from; k < to; k++) { total += counts[k]; sum += k * counts[k]; }
    let below = 0, belowSum = 0, best = -1, split = from + 1;
    for (let k = from; k < to - 1; k++) {
      below += counts[k]; belowSum += k * counts[k];
      const above = total - below;
      if (below == 0 || above == 0) continue;
      const between = below * above * (belowSum / below - (sum - belowSum) / above) ** 2;
      if (between > best) { best = between; split = k + 1; }
    }
    return split;
  };
  let split = otsu(0, BINS);
  // (smoothed over 5 bins, so a little noise isn't taken for a gap)
  const smooth = k => { let v = 0; for (let j = k - 2; j <= k + 2; j++) v += counts[Math.max(0, Math.min(BINS - 1, j))]; return v / 5; };
  const inner = otsu(split, BINS);
  let low = inner, peakBelow = 0, peakAbove = 0;
  for (let k = split; k < BINS; k++) {
    if (k < inner) peakBelow = Math.max(peakBelow, smooth(k)); else peakAbove = Math.max(peakAbove, smooth(k));
  }
  // the emptiest bin between the two groups' peaks
  const top = k => k < inner ? peakBelow == smooth(k) : peakAbove == smooth(k);
  let from = split, to = BINS - 1;
  for (let k = split; k < inner; k++) if (top(k)) from = k;
  for (let k = BINS - 1; k >= inner; k--) if (top(k)) to = k;
  for (let k = from; k <= to; k++) if (smooth(k) < smooth(low)) low = k;
  if (smooth(low) < 0.35 * Math.min(peakBelow, peakAbove)) split = low;
  return split / BINS * most;
}

// For every pixel, roughly how far it is (in pixels) from the nearest pixel of the other kind:
// for ink, from the nearest background; for background, from the nearest ink. (A chamfer distance:
// two passes over the picture, steps of 1 straight and 1.4 on a slant.)
function distanceToOther(ink, width, height, wantInk){
  const far = 1e9;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = (ink[i] == 1) == wantInk ? far : 0;
  const S = 1, D = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (d[i] == 0) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + S);
      if (y > 0) {
        v = Math.min(v, d[i - width] + S);
        if (x > 0) v = Math.min(v, d[i - width - 1] + D);
        if (x < width - 1) v = Math.min(v, d[i - width + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (d[i] == 0) continue;
      let v = d[i];
      if (x < width - 1) v = Math.min(v, d[i + 1] + S);
      if (y < height - 1) {
        v = Math.min(v, d[i + width] + S);
        if (x < width - 1) v = Math.min(v, d[i + width + 1] + D);
        if (x > 0) v = Math.min(v, d[i + width - 1] + D);
      }
      d[i] = v;
    }
  }
  return d;
}

// How thick the lines are, in pixels. Through every ink pixel, the run of ink is measured four
// ways (across, down, and both slants); the shortest is that line's width there (a slanted run
// of n pixels is n × 1.4 long). The most common width is taken. Only the ink from x = `left` to
// `right` counts (by default, all of it).
function lineWidth(ink, width, height, left = 0, right = width - 1){
  const shortest = new Float32Array(width * height).fill(Infinity);
  const inside = (px, py) => px >= left && px <= right && py >= 0 && py < height && ink[py*width + px];
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const step = Math.hypot(dx, dy);
    const seen = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = left; x <= right; x++) {
        const i = y*width + x;
        if (!ink[i] || seen[i]) continue;
        // (back to where this run starts, then along it)
        let sx = x, sy = y;
        while (inside(sx - dx, sy - dy)) { sx -= dx; sy -= dy; }
        const run = [];
        for (let px = sx, py = sy; inside(px, py); px += dx, py += dy) run.push(py*width + px);
        for (const k of run) { seen[k] = 1; shortest[k] = Math.min(shortest[k], run.length * step); }
      }
    }
  }
  const counts = new Map();
  for (let i = 0; i < shortest.length; i++) {
    if (!ink[i] || shortest[i] == Infinity) continue;
    const w = Math.round(shortest[i] * 2) / 2;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  if (counts.size == 0) return 1;
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}


// =============================================================================
// Reading a column
// =============================================================================

// The punctuation marks as they were drawn before November 2026 (before the digits came and the
// marks were redrawn), for reading older pictures: each as a stand-in character of its own (from
// the Private Use Area, so never taken as typed), with the mark it stands for and its lines.
// The old + / and — look like today's 5, / and -, so these are only tried in a reading of their own.
const OLD_MARKS = {
  '\uE020': ['.', [[0, -0.5, 0, 0.5], [-0.5, 0, 0.5, 0]]],                                     // +
  '\uE021': [',', [[0.5, -0.5, -0.5, 0.5]]],                                                   // /
  '\uE022': ["'", [[-0.5, 0, 0.5, 0]]],                                                        // —
  '\uE023': ['"', [[-0.5, -0.25, 0.5, -0.25], [-0.5, 0.25, 0.5, 0.25]]],                       // =
  '\uE024': ['!', [[0, -0.5, 0, 0.5], [-0.5, -0.25, 0.5, -0.25], [-0.5, 0.25, 0.5, 0.25]]],    // ‡
};
for (const [ch, [, lines]] of Object.entries(OLD_MARKS)) PUNCTUATION[ch] = lines;

// Every character the decoder tries, each drawing once (‘ draws as ', and " as “), with the most
// ink first: the search finds the right answer sooner when the bigger shapes go first. Today's
// marks, or (for older pictures, see OLD_MARKS) the old ones, with the ? that hasn't changed.
const byInk = chars => {
  const length = ch => characterSegments(ch, undefined)
    .reduce((sum, [x1, y1, x2, y2]) => sum + Math.hypot(x2 - x1, y2 - y1), 0);
  return chars.sort((a, b) => length(b) - length(a));
};
const DECODE_CHARS = byInk([...Object.keys(LETTERS),
  ...Object.keys(PUNCTUATION).filter(ch => ch != '‘' && ch != '"' && !Object.hasOwn(OLD_MARKS, ch))]);
const OLD_DECODE_CHARS = byInk([...Object.keys(LETTERS), '?', ...Object.keys(OLD_MARKS)]);

// The same drawing, whichever way it's typed (see DECODE_CHARS)
const sameDrawing = ch => ch == '‘' ? "'" : ch == '"' ? '“' : ch;

// In a loose reading (see searchColumn), an extra line beside a stroke that another one overlaps,
// as older pictures and other encoders mark overlaps: a "character" of its own, with no text
const MARKER = '\u0001';

// The text the drawn characters stand for: digits with a middle line as plain digits (see TICKED),
// old marks as the marks they stand for (see OLD_MARKS), and markers as nothing
function textOf(chars){
  return chars.map(ch => ch == MARKER ? '' : OLD_MARKS[ch]?.[0] ?? readableChar(ch)).join('');
}

// Does drawing this text give exactly these characters? Not every string of shapes can come from
// a text: a lone 4 is always drawn with its middle line, and a V between two letters is drawn
// as Λ (it's an apostrophe), so such a reading can't be right.
function drawsAs(text, chars){
  const drawn = [...drawableText(text)].map(sameDrawing).join('');
  return drawn == chars.map(sameDrawing).join('');
}

// The tolerances, in pixels, for a picture with line size L and lines r thick on each side:
//   onInk: how far off the ink a character's line may stray (the picture is never exact);
//   covers: how far from a line a pixel of ink may be, to be explained by it.
// `covers` is kept tight: with it loose, a few small marks around a letter's middle (3, 1 and a
// dot) would pass for the letter's long stroke.
function tolerances(L, r){
  return { onInk: Math.max(1, 0.12 * L), covers: r + Math.max(1, 0.06 * L) };
}

// Read one column. `column`:
//   pixels: { xs, ys } the column's ink pixels (their middles), from top to bottom
//   x: the column's middle; top: the y of position 0 (the top of a column with nothing before
//   it); L: the line size; r: half the line width; spaces: how many spaces the column starts with
//   outside: (x, y) -> how far that point is from ink (see distanceToOther)
//   inside: (x, y) -> how far that point is inside the ink (for a loose reading's markers)
//   deadline: (optional) the time (as Date.now()) to give up at
//   tried: (optional) the characters to try (DECODE_CHARS, or OLD_DECODE_CHARS for older pictures)
//   loose: (optional) true for a loose reading: characters aren't placed by today's spacing rules,
//     but wherever there's ink for them, at a quarter step, at least half a step below the one
//     before (where words end is worked out afterwards, see looseText); and an extra line beside
//     a recent stroke, a quarter to half a step to the side, may mark an overlap (see MARKER).
//     For older pictures, and other encoders.
//   from: (optional) { chars, positions }: the characters another way already read at the top of
//     the column (placed by today's rules), to carry on from
// Returns { readings, placed, best }: the readings (lists of drawn characters) that explain all of
// the ink, best first (see below), with their positions, and the furthest the search got (for
// fitting the sizes, see fitColumn).
function searchColumn(column, budget = 20000){
  const { pixels, x: cx, top, L, r, spaces, outside, inside, tried = DECODE_CHARS, loose = false, from = null } = column;
  // (old marks, or loose spacing: today's rules can't check those, see drawsAs)
  const checked = tried === DECODE_CHARS && !loose;
  const { onInk, covers } = tolerances(L, r);
  const total = pixels.ys.length;
  const allowed = 2 + Math.floor(total * 0.0005);   // ink that may stay unexplained (specks)

  // A character's lines, in pixels, with its middle at position `y`
  const linesAt = (chars, j, y) => characterSegments(chars[j], chars[j - 1])
    .map(([x1, y1, x2, y2]) => [cx + L*x1, top + L*(y + y1), cx + L*x2, top + L*(y + y2)]);

  // Do all of these lines lie on ink?
  const onTheInk = lines => lines.every(([x1, y1, x2, y2]) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
    for (let s = 0; s <= steps; s++) {
      if (outside(x1 + (x2 - x1) * s / steps, y1 + (y2 - y1) * s / steps) > onInk) return false;
    }
    return true;
  });

  // Explain the ink from pixel `from` on, down to (not including) the height `until`, with the
  // lines of the characters before `last`; returns where it stopped, and how much ink was left
  // unexplained, or null if that's too much
  const explain = (state, from, until, last) => {
    let left = state.unexplained;
    let k = from;
    for (; k < total && pixels.ys[k] < until; k++) {
      const px = pixels.xs[k], py = pixels.ys[k];
      let explained = false;
      for (let j = last - 1; j >= 0 && !explained; j--) {
        if (state.chars[j] == ' ') continue;
        if (top + L*(state.positions[j] + 1) + covers < py) break;   // (this one and those above are too high)
        explained = state.lines[j].some(line => pointSegmentDistance(px, py, line) <= covers);
      }
      if (!explained && ++left > allowed) return null;
    }
    return { next: k, unexplained: left };
  };

  // Is there ink for all of the character's lines (their ends and middles), with its middle at
  // some quarter step from position `from` to `to`? (Every position is a whole quarter.)
  const inkFor = (ch, previousCh, from, to) => {
    const points = characterSegments(ch, previousCh).flatMap(([x1, y1, x2, y2]) =>
      [[x1, y1], [x2, y2], [(x1 + x2) / 2, (y1 + y2) / 2]]);
    for (let y = Math.ceil(from * 4 - 1e-9) / 4; y <= to + 1e-9; y += 0.25) {
      if (points.every(([u, v]) => outside(cx + L*u, top + L*(y + v)) <= onInk)) return true;
    }
    return false;
  };

  // Is ink pixel k explained by the characters of `state`? (A letter that has yet to move down
  // explains its ink where it will be.) Worked out once per state and pixel: the state's next
  // characters all ask the same.
  const explainedBy = (state, k) => {
    const memo = state.memo ??= new Uint8Array(total);   // (0: not known yet, 1: yes, 2: no)
    if (memo[k]) return memo[k] == 1;
    const px = pixels.xs[k], py = pixels.ys[k];
    let explained = false;
    for (let j = state.chars.length - 1; j >= 0 && !explained; j--) {
      if (state.chars[j] == ' ') continue;
      const moving = j === state.mustMove;
      if (top + L*(state.positions[j] + (moving ? 1.5 : 1)) + covers < py) break;   // (this one and those above are too high)
      explained = (moving ? state.movedLines : state.lines[j]).some(line => pointSegmentDistance(px, py, line) <= covers);
    }
    memo[k] = explained ? 1 : 2;
    return explained;
  };

  // explain, for a state whose characters before the last are `parent`'s, where they were (or
  // where the letter that had to move went)
  const explainAsParent = (parent, until) => {
    let left = parent.unexplained;
    let k = parent.explained;
    for (; k < total && pixels.ys[k] < until; k++) {
      if (!explainedBy(parent, k) && ++left > allowed) return null;
    }
    return { next: k, unexplained: left };
  };

  // The state after adding a few spaces and a character to `state` (giving `chars`, placed at
  // `positions`), or null if it can't be right
  const extend = (state, chars, positions) => {
    const lines = [...state.lines];
    const last = chars.length - 1;
    // A letter that has to move down still (see below) must have moved by now
    if (state.mustMove != null && positions[state.mustMove] == state.positions[state.mustMove]) return null;
    let mustMove = null, movedLines = null;
    for (let j = 0; j < chars.length; j++) {
      if (j < state.chars.length && positions[j] == state.positions[j]) continue;
      lines[j] = chars[j] == ' ' ? [] : linesAt(chars, j, positions[j]);
      if (onTheInk(lines[j])) continue;
      // The newest letter, half a step after a letter, may still be moved down to a full step
      // once the next letter comes (see evenOutSpacing): it may sit there instead, for now
      const isLetter = ch => ch != ' ' && !isPunctuation(ch);
      const movable = j == last && j > 0 && isLetter(chars[j]) && isLetter(chars[j - 1]) &&
                      positions[j] - positions[j - 1] == 0.5;
      if (!movable) return null;
      movedLines = linesAt(chars, j, positions[j - 1] + 1);
      if (!onTheInk(movedLines)) return null;
      mustMove = j;
    }
    const next = { chars, positions, lines, mustMove, movedLines, explained: state.explained, unexplained: state.unexplained };
    // Nothing from the newest character on reaches above one line size over its middle
    const until = top + L*(positions[last] - 1) - covers;
    const asParent = state.chars.every((_, j) => j === state.mustMove
      ? positions[j] == positions[j - 1] + 1 : positions[j] == state.positions[j]);
    const done = asParent ? explainAsParent(state, until) : explain(next, state.explained, until, last);
    if (!done) return null;
    next.explained = done.next;
    next.unexplained = done.unexplained;
    return next;
  };

  // Has `state` explained all of the ink? (null if not, or how much was left unexplained)
  const finished = state => {
    if (state.chars.length == spaces || state.mustMove != null) return null;
    return explainAsParent(state, Infinity)?.unexplained ?? null;
  };

  // How high the next character must reach: the first ink, from where `state` got to, that none
  // of its characters explain (past the few specks still allowed). A letter that has yet to move
  // down explains its ink where it will be.
  const firstUnexplained = state => {
    let left = allowed - state.unexplained;
    for (let k = state.explained; k < total; k++) {
      if (!explainedBy(state, k) && --left < 0) return pixels.ys[k];
    }
    return Infinity;
  };

  // A loose reading's next characters (see `loose`): markers, then each character wherever it can
  // go, the highest first
  const looseChildren = (state, lowest) => {
    const children = [], markers = [];
    let last = state.chars.length - 1;
    while (last >= 0 && (state.chars[last] == ' ' || state.chars[last] == MARKER)) last--;
    const lastY = last >= 0 ? state.positions[last] : null;
    const reach = state.positions.at(-1) ?? 0;   // (positions never go back up: see explainedBy)
    for (const ch of tried) {
      const own = characterSegments(ch, undefined);
      const points = own.flatMap(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2], [(x1 + x2) / 2, (y1 + y2) / 2]]);
      const ys = [];
      // (the first one: its top at the column's topmost ink, or up to a step lower, where a later
      // character reaches higher. Columns needn't start at the same height.)
      if (lastY == null) {
        const high = Math.round(((pixels.ys[0] + r - top) / L - letterTop(ch)) * 4) / 4;
        ys.push(-letterTop(ch) + spaces);   // (where today's rules put it)
        for (let y = high; y <= high + 1; y += 0.25) if (y != ys[0]) ys.push(y);
      }
      else for (let y = lastY + 0.5; y <= Math.min(lowest, lastY + 4) + 1e-9; y += 0.25) ys.push(y);
      for (const y of ys) {
        if (!points.every(([u, v]) => outside(cx + L*u, top + L*(y + v)) <= onInk)) continue;
        const lines = own.map(([x1, y1, x2, y2]) => [cx + L*x1, top + L*(y + y1), cx + L*x2, top + L*(y + y2)]);
        if (!onTheInk(lines) || !ownInk(state, lines)) continue;
        // (where the words end is worked out once the whole picture is read: see looseSpaces)
        const next = addLoose(state, [ch], Math.max(y, reach), lines, top + L*(y - 1) - covers);
        if (next) children.push(next);
      }
    }
    // A marker: a recent stroke, a quarter to half a step to the side (all of it, or either half).
    // Only where it explains ink no line explains yet, and no more than two in a row.
    const inARow = state.chars.length - 1 - state.chars.findLastIndex(ch => ch != MARKER);
    const recent = state.lines.slice(-6).flat();
    const isNew = ([a, b, c, d]) => !recent.some(line => pointSegmentDistance((a + c) / 2, (b + d) / 2, line) <= covers);
    for (let j = state.chars.length - 1, seen = 0; j >= 0 && seen < 3 && inARow < 2 && lastY != null; j--) {
      if (state.chars[j] == ' ' || state.chars[j] == MARKER) continue;
      seen++;
      for (const [x1, y1, x2, y2] of state.lines[j]) {
        if (y1 == y2) continue;   // (not beside a level stroke: that's = or a dash)
        // (encoders put markers at their own distance: on each side, only the one that runs most
        // squarely along the ink)
        for (const side of [-1, 1]) {
          let best = null, bestDepth = 0;
          for (const away of [0.25, 0.375, 0.5]) {
            const dx = side * away;
            const [a, b, c, d] = [x1 + dx*L, y1, x2 + dx*L, y2], [mx, my] = [(a + c) / 2, (b + d) / 2];
            for (const line of [[a, b, c, d], [a, b, mx, my], [mx, my, c, d]]) {
              if (!isNew(line) || !onTheInk([line])) continue;
              const depth = depthAlong(line) + 0.01 * Math.hypot(line[2] - line[0], line[3] - line[1]);   // (the longer, if as deep)
              if (depth > bestDepth) { best = line; bestDepth = depth; }
            }
          }
          if (!best) continue;
          const next = addLoose(state, [MARKER], reach, [best], top + L*(lastY - 1) - covers);
          if (next) markers.push(next);
        }
      }
    }
    // (markers first: where one explains the ink, a letter drawn over the stroke it doubles would
    // explain it too, wrongly)
    return [...markers, ...children];
  };

  // How deep inside the ink a line runs, on average (up to the line's half-width)
  const depthAlong = ([x1, y1, x2, y2]) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
    let sum = 0;
    for (let k = 0; k <= steps; k++) sum += Math.min(inside(x1 + (x2 - x1) * k / steps, y1 + (y2 - y1) * k / steps), r + 0.5);
    return sum / (steps + 1);
  };

  // Do these lines (of a new character) explain some ink of their own? At least a quarter of their
  // length must be away from every recent line: otherwise it's a letter drawn over ones already
  // read (a second e on the e of "concept")
  const ownInk = (state, lines) => {
    const recent = state.lines.slice(-8).flat();
    let all = 0, own = 0;
    for (const [x1, y1, x2, y2] of lines) {
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
      for (let k = 0; k <= steps; k++) {
        const px = x1 + (x2 - x1) * k / steps, py = y1 + (y2 - y1) * k / steps;
        all++;
        if (!recent.some(line => pointSegmentDistance(px, py, line) <= covers)) own++;
      }
    }
    return own >= 0.25 * all;
  };

  // `state` with `added` (a few spaces and a character, or a marker) at position `y`, the last of
  // them drawing `lines`; ink above `until` must be explained by then. Null if it can't be right.
  const addLoose = (state, added, y, lines, until) => {
    const chars = [...state.chars, ...added];
    const positions = [...state.positions, ...added.map(() => y)];
    const allLines = [...state.lines, ...added.map(() => []).slice(1), lines];
    const done = explainAsParent(state, until);
    if (!done) return null;
    return { chars, positions, lines: allLines, mustMove: null, movedLines: null, explained: done.next, unexplained: done.unexplained };
  };

  let start = { chars: [...' '.repeat(spaces)], positions: [], lines: [], mustMove: null, movedLines: null, explained: 0, unexplained: 0 };
  start.positions = placeLine(start.chars);
  start.lines = start.chars.map(() => []);
  if (from?.chars.length) {
    const chars = [...start.chars, ...from.chars], positions = [...start.positions, ...from.positions];
    const carried = { ...start, chars, positions, lines: chars.map((ch, j) => ch == ' ' ? [] : linesAt(chars, j, positions[j])) };
    const done = explain(carried, 0, top + L*(positions.at(-1) - 1) - covers, chars.length - 1);
    if (done) start = { ...carried, explained: done.next, unexplained: done.unexplained };
  }

  const readings = [];
  let best = start, nodes = 0, after = Infinity;
  const stack = [start];
  while (stack.length && nodes < budget && nodes < after) {
    if (nodes % 64 == 0 && column.deadline && Date.now() > column.deadline) break;   // (out of time)
    const state = stack.pop();
    nodes++;
    if (state.explained > best.explained || (state.explained == best.explained && state.chars.length > best.chars.length)) best = state;
    const left = finished(state);
    if (left != null) {
      const chars = state.chars.slice(spaces);
      if (!checked || drawsAs(textOf(chars), chars)) {
        readings.push({ chars, positions: state.positions.slice(spaces), unexplained: left });
        if (readings.length == 1) after = nodes + 3000;   // (a little longer, for other readings)
        if (readings.length >= 4) break;
      }
      continue;
    }
    // Every character, after 0, 1, 2... spaces (the first character after the column's own
    // spaces), that's not too far down to explain the ink nothing explains yet
    const children = [];
    const hasCharacter = state.chars.length > spaces;
    const mustReach = firstUnexplained(state);
    // (the lowest position that still reaches it; with all the ink explained, the lowest ink)
    const lowest = (Math.min(mustReach, total ? pixels.ys[total - 1] : 0) + covers - top) / L + 1;
    if (loose) children.push(...looseChildren(state, lowest));
    else for (let gap = 0; gap <= (hasCharacter ? 12 : 0); gap++) {
      let anyInReach = false;
      for (const ch of tried) {
        // (placing a punctuation mark takes a while: first a quick look for ink where it could go)
        if (gap == 0 && hasCharacter && isPunctuation(ch) &&
            !inkFor(ch, state.chars.at(-1), state.positions.at(-1) + 0.5, lowest)) continue;
        const chars = [...state.chars, ...' '.repeat(gap), ch];
        const positions = placeLine(chars, state.positions);
        if (top + L*(positions.at(-1) - 1) - covers > mustReach) continue;
        anyInReach = true;
        const next = extend(state, chars, positions);
        if (next) children.push(next);
      }
      if (!anyInReach) break;
    }
    // (the stack takes the last one first: the best guesses go on last)
    for (let k = children.length - 1; k >= 0; k--) stack.push(children[k]);
  }
  // Only the readings that leave the fewest specks unexplained: two of those can't be told apart
  readings.sort((a, b) => a.unexplained - b.unexplained);
  const fewest = readings[0]?.unexplained;
  const kept = readings.filter(g => g.unexplained == fewest);
  return { readings: kept.map(g => g.chars), placed: kept.map(g => g.positions), best: { ...best, chars: best.chars.slice(spaces), positions: best.positions.slice(spaces),
                             lines: best.lines.slice(spaces), all: total }, nodes };
}


// =============================================================================
// Fitting
// =============================================================================

// The line size, the column's middle and the top that best fit the characters read so far: the
// lines' points are moved and stretched until they sit as deep inside the ink as they can.
// `fix` lists what mustn't change ('L', 'top'). Returns { L, x, top }.
function fitColumn(chars, positions, guess, inside, r, fix = [], loose = false){
  // Points along every line, in line sizes from (column middle, position 0)
  const points = [];
  chars.forEach((ch, j) => {
    if (ch == ' ' || ch == MARKER) return;
    for (const [x1, y1, x2, y2] of characterSegments(ch, loose ? undefined : chars[j - 1])) {
      const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) * 8));
      for (let s = 0; s <= steps; s++) {
        points.push([x1 + (x2 - x1) * s / steps, positions[j] + y1 + (y2 - y1) * s / steps]);
      }
    }
  });
  if (points.length == 0) return guess;
  const score = (L, x, top) => {
    let sum = 0;
    for (const [u, v] of points) sum += Math.min(inside(x + L*u, top + L*v), r + 0.5);
    return sum;
  };
  let bestFit = { ...guess }, bestScore = score(guess.L, guess.x, guess.top);
  const search = (Lstep, Lsteps, step, steps) => {
    const centre = { ...bestFit };
    const Ls = fix.includes('L') ? [centre.L] : range(Lsteps).map(k => centre.L * (1 + k * Lstep));
    const tops = fix.includes('top') ? [centre.top] : range(steps).map(k => centre.top + k * step);
    for (const L of Ls) for (const top of tops) for (const k of range(steps)) {
      const s = score(L, centre.x + k * step, top);
      if (s > bestScore) { bestScore = s; bestFit = { L, x: centre.x + k * step, top }; }
    }
  };
  search(0.004, 12, 0.5, 4);       // within about 5% and 2 pixels
  search(0.0008, 5, 0.125, 4);     // then finer
  return bestFit;
}

// -n ... n
const range = n => Array.from({ length: 2*n + 1 }, (_, k) => k - n);


// =============================================================================
// The whole picture
// =============================================================================

// Read a picture of AIDAScript in the rectangle shape, one way (decodeAnyHow tries them all).
// `ink` is a Uint8Array of 0 and 1 (see inkMask), `width` × `height` pixels. Returns
//   { text, columns: [{ x, text, readings, read, skipped, drawing }], lineSize, sizes, unread, skipped, timedOut }
// `text` is the whole text, columns joined by line breaks (or spaces, where a column looks like
// the rest of a line that was too long: see joinColumns). A column that couldn't be read in full
// has read: false, and text with what was read of it; `unread` counts those. Ink that barely
// reads at all (a drawing beside the text, say) is left out of the text: skipped: true, counted
// by `skipped` (drawing: true where its lines are another width, so it's surely no text).
// `sizes` ({ L, top, w }) are the line size, the top and the line width it read with.
// Options:
//   timeLimit: after this many milliseconds it stops trying, and `timedOut` is true
//   tried: the characters it tries (DECODE_CHARS: today's, or OLD_DECODE_CHARS)
//   loose: whether characters may sit anywhere (see searchColumn)
//   sizes: the sizes, if already known (from another way of reading the same picture)
//   done: the middles of columns already read (another way): those aren't read again, and come
//     back as { x, done: true }
//   partial: what another way read of columns it couldn't read in full ([{ x, chars, positions }],
//     see `partial` in the columns that come back): those are read on from there
function decodePicture(ink, width, height, { timeLimit = 15000, tried = DECODE_CHARS, loose = false, sizes = null, done = [], partial = [] } = {}){
  const deadline = Date.now() + timeLimit;   // (a picture it can't read could keep it busy a long time)
  const inside = distanceToOther(ink, width, height, true);
  const outsideMap = distanceToOther(ink, width, height, false);
  const at = map => (x, y) => {
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return map === outsideMap ? 1e9 : 0;
    return map[py * width + px];
  };
  const inkAt = at(inside), outside = at(outsideMap);

  const bands = inkBands(ink, width, height);
  if (bands.length == 0) return { text: '', columns: [], lineSize: null, sizes: null, unread: 0, skipped: 0 };

  // The line width is measured band by band: text is written with one pen, so a band with lines
  // much thicker or thinner than the text's is something else (a drawing beside the text, say).
  // w and r are those of the band being read.
  for (const band of bands) band.w = lineWidth(ink, width, height, band.left, band.right);
  const samePen = (a, b) => Math.abs(a - b) <= Math.max(1.5, 0.3 * Math.max(a, b));
  let w, r;
  const usePen = band => { w = band.w; r = w / 2; };

  const columnTop = band => band.top ?? band.pixels.ys[0] - 0.5 + r;   // (where its topmost line is)
  // (the topmost line of any band written with the same pen as this one)
  const textTop = band => Math.min(...bands.filter(other => samePen(other.w, band.w)).map(columnTop));
  const bandWidth = band => band.right - band.left + 1 - w;   // (from the left line to the right one)

  // A column reaches 0, half or one line size left of its middle, and the same to the right; so
  // a band is 0.5, 1, 1.5 or 2 line sizes wide (plus the line width). Every way that can be, as
  // { L, x }. With L, the line size, known: every middle that's 0, half or one line size in from
  // either side.
  const shapes = (band, L) => {
    const found = [];
    if (L) {
      for (const reach of [1, 0.5, 0]) {
        for (const x of [band.left + r + reach * L, band.right + 1 - r - reach * L]) {
          if (!found.some(shape => Math.abs(shape.x - x) < 1)) found.push({ L, x });
        }
      }
      return found;
    }
    for (const span of [2, 1.5, 1, 0.5]) {
      for (const left of [1, 0.5, 0]) {
        const right = span - left;
        if (right < 0 || right > 1) continue;
        const size = bandWidth(band) / span;
        if (size >= 3) found.push({ L: size, x: band.left + r + left * size });
      }
    }
    return found;
  };

  // How far a go got (a full reading beats everything)
  const progress = go => go.readings.length ? Infinity : go.best.explained / Math.max(1, go.best.all);   // (how much of its ink)

  // Read one band as a column: every way it might be laid out is tried (see shapes), with the
  // line size a little bigger or smaller too, since it's only guessed from the band's width;
  // then the sizes are fitted to what the best of those read, and the column read again, while
  // that gets further. `fix` lists what's already known ('L', 'top'); `middle`, if known, is
  // where the column's middle is. Returns the best go.
  const readBand = (band, L0, top0, fix, middle = null) => {
    const attempt = (guess, budget) => {
      // (a column's top is a whole number of line sizes down, one per space it starts with, and
      // up to half a line size more where a later character reaches higher than its first)
      const spaces = Math.max(0, Math.round((columnTop(band) - guess.top) / guess.L + 0.25));
      return { ...searchColumn({ pixels: band.pixels, x: guess.x, top: guess.top, L: guess.L, r, spaces, outside, inside: inkAt, deadline, tried, loose, from: band.from }, budget),
               guess, spaces };
    };
    let best = null;
    const consider = go => { if (!best || progress(go) > progress(best)) best = go; return go.readings.length > 0; };

    // Fit the sizes to the furthest go (all but its last character, which may be wrong), and
    // read again, while that gets further
    const fitAndRead = () => {
      // (fewer, smaller tries in a loose reading: each try takes longer there)
      for (let round = 0; round < (loose ? 2 : 6) && best; round++) {
        const chars = best.best.chars.slice(0, -1);
        if (chars.filter(ch => ch != ' ').length == 0) return false;
        const fitted = fitColumn(chars, best.best.positions.slice(0, -1), best.guess, inkAt, r, fix, loose);
        const before = progress(best);
        if (consider(attempt(fitted, loose ? 3000 : 6000))) return true;
        if (Date.now() > deadline) return false;
        if (progress(best) <= before) return false;
      }
      return false;
    };

    // A later character can reach higher than the first (a letter that points up, after one that
    // doesn't): the column's top may then be a little below its topmost ink (`top0`)
    const total = band.pixels.ys.length;
    for (const lift of fix.includes('top') ? [0] : [0, 0.25, 0.5]) {
      for (const shape of middle != null ? [{ L: L0, x: middle }] : shapes(band, fix.includes('L') ? L0 : null)) {
        const stretches = fix.includes('L') ? [0] : [0, 0.01, -0.01, 0.02, -0.02, 0.03, -0.03, 0.05, -0.05, 0.08, -0.08, 0.12, -0.12];
        for (const stretch of stretches) {
          const L = shape.L * (1 + stretch);
          const x = band.left + r + (shape.x - band.left - r) * (1 + stretch);
          const go = attempt({ L, x, top: top0 + lift * L }, 1500);
          if (consider(go) || Date.now() > deadline) return best;
          // (a good start is worth fitting to straight away)
          if (go === best && go.best.explained > 0.25 * total && fitAndRead()) return best;
        }
      }
      if (fitAndRead()) return best;
    }
    return best;
  };

  // Several columns side by side with no gap between their ink (their spacing is less than the
  // line width) make one band, too wide for a column. For those, the line size is guessed from
  // the horizontal strokes instead (see strokeLengths), and the columns are read one after
  // another from the left (see readTouching).

  // Only the ink of a band near the middle `x`: well clear of the next column's ink, which can
  // come to within a line width of this column's furthest lines (L from the middle)
  // (Its top is where its topmost line is: as far out as its own lines go, less the line width.)
  const strip = (band, x, L) => {
    const xs = [], ys = [];
    let top = Infinity;
    band.pixels.xs.forEach((px, k) => {
      const out = Math.abs(px - x);
      if (out <= 0.9 * L - r) { xs.push(px); ys.push(band.pixels.ys[k]); }
      if (out <= L - r) top = Math.min(top, band.pixels.ys[k] - 0.5 + r);
    });
    return { left: Math.floor(x - L - r), right: Math.ceil(x + L + r), pixels: { xs, ys }, top };
  };

  // Read touching columns, from the left: the first column's middle is 0, half or one line size
  // in from the band's left side; the next one is two line sizes on, plus the spacing (from
  // nothing to a little more than the line width, found by trying), and from then on every
  // column is as far on again. Returns the columns' goes (null for an empty column).
  const readTouching = (band, L, top) => {
    const gos = [];
    let pitch = null, x = null;
    while (Date.now() <= deadline) {
      const middles = x == null ? [1, 0.5, 0].map(reach => band.left + r + reach * L)
                    : pitch ? [x + pitch]
                    : Array.from({ length: Math.ceil((w + 2) * 2) + 1 }, (_, k) => x + 2*L + k / 2);
      if (middles[0] - r > band.right) break;
      let best = null;
      for (const middle of middles) {
        const part = strip(band, middle, L);
        if (part.pixels.ys.length == 0) continue;
        const go = readBand(part, L, top, ['L', 'top'], middle);
        if (!best || progress(go) > progress(best)) best = go;
        if (go.readings.length) break;
      }
      if (!best && pitch == null) break;   // (nothing more to read)
      gos.push(best);
      // (a column that barely reads: this is no text, or the rest wouldn't read either)
      if (best && !best.readings.length && progress(best) < 0.5) break;
      const next = best ? best.guess.x : x + pitch;
      if (x != null && pitch == null) pitch = next - x;
      x = next;
    }
    while (gos.length && !gos.at(-1)) gos.pop();   // (past the last column)
    return gos;
  };

  const upToLastLetter = (chars, positions) => {
    // (and before any mark: a strict reading that gets stuck in an older picture often guessed a
    // mark wrong, and read on a little)
    const mark = chars.findIndex(ch => isPunctuation(ch));
    const letters = mark < 0 ? chars : chars.slice(0, mark);
    const end = letters.findLastIndex(ch => Object.hasOwn(LETTERS, ch)) + 1;
    return { chars: chars.slice(0, end), positions: positions.slice(0, end) };
  };

  // What was read of a column that didn't read all the way: where it got stuck, it was still
  // guessing, usually digits and marks right after the last letters (a mark it doesn't know
  // reads as a few of those): those are left off, and "…" shows that the column goes on
  const partly = (chars, positions) => {
    const text = (loose ? looseText(chars, positions) : textOf(chars)).trimEnd();
    const sure = text.replace(/(?<=\p{L})[^\p{L} ]+$/u, '');
    return sure ? sure + '…' : '';
  };

  // First a band that reads, which settles the line size and the top for all of them: the one
  // with the most ink, or if that doesn't read (it could be a drawing, not text), the next one
  const order = [...bands].sort((a, b) => b.pixels.ys.length - a.pixels.ys.length);
  // A band is read as one column, or failing that (if it's too wide for one) as touching columns,
  // by its first one, kept only if that reads in full. (One column goes first: the horizontal
  // strokes say little where there are few of them, and a wrong line size can read as nonsense.)
  const asOne = band => readBand(band, null, textTop(band), []);
  const halfway = Date.now() + timeLimit / 2;   // (asTouching stops here: there's more to read after it)
  const asTouching = band => {
    const sizes = strokeLengths(ink, width, height, w, band.left, band.right);
    for (const size of sizes.filter(size => bandWidth(band) > 2.4 * size)) {
      for (const reach of [1, 0.5, 0]) {
        if (Date.now() > halfway) return null;
        const middle = band.left + r + reach * size;
        const go = readBand(strip(band, middle, size * 1.08), size, textTop(band), [], middle);
        // (at a wrong line size, small marks and big gaps can explain all the ink too: text is
        // mostly letters, with a space or two between words)
        const chars = go.readings[0]?.filter(ch => ch != ' ') ?? [];
        const gaps = textOf(go.readings[0] ?? []).includes('   ');
        if (chars.length && !gaps && chars.filter(ch => !isPunctuation(ch)).length >= chars.length / 2) return go;
      }
    }
    return null;
  };
  // Each band as one column first (quick), then as touching columns (slow: a drawing could take
  // all the time there is), until one reads. (Between bands, the best is the one that explained
  // the most ink, not the most of its own: a narrow strip of a drawing can be a third explained
  // by chance.)
  let main = null, mainBand = null;
  const explained = go => go.readings.length ? Infinity : go.best.explained;
  if (!sizes) search: for (const read of [asOne, asTouching]) {
    for (const band of order.slice(0, 6)) {
      if (main && Date.now() > (read == asTouching ? halfway : deadline)) break search;
      usePen(band);
      const go = read(band);   // (null if it can't be read that way at all)
      if (!go) continue;
      if (!main || explained(go) > explained(main)) { main = go; mainBand = band; }
      if (go.readings.length) break search;
    }
  }
  if (sizes) mainBand = { w: sizes.w };   // (no band of its own)
  if (!sizes && !main) return { text: '', columns: [], lineSize: null, sizes: null, unread: 0, skipped: 0 };
  usePen(mainBand);
  // (a short column can read with the line size a little off: fitted to all of it, it's exact, for
  // the longer columns to come)
  if (main?.readings.length) {
    main = { ...main, guess: fitColumn(main.readings[0], main.placed[0], main.guess, inkAt, r, [], loose) };
  }
  const L = sizes ? sizes.L : main.guess.L;
  // (where a column that starts with no spaces starts)
  const top = sizes ? sizes.top : main.guess.top + main.spaces * L;

  // Bands that together are no wider than a column are one column: an overlap marker, a colon's
  // dot or a parenthesis can stand apart from the rest of their column. A band wider than that
  // is several columns touching; a sliver of ink just after one (half a line size on, no wider
  // than a line) is the last of those columns' marker or dot.
  const columnWidth = 2*L + w + Math.max(2, 0.1 * L);
  const groups = [];
  for (const band of bands) {
    const last = groups.at(-1);
    const sliver = last && band.right - band.left + 1 <= w + 2 && band.left - last.right <= 0.5*L + r + 1;
    if (last && (band.right - last.left + 1 <= columnWidth || sliver)) {
      last.parts.push(band);
      last.right = band.right;
    } else {
      groups.push({ left: band.left, right: band.right, parts: [band] });
    }
  }
  for (const group of groups) {
    const ys = group.parts.flatMap(part => part.pixels.ys), xs = group.parts.flatMap(part => part.pixels.xs);
    const byHeight = ys.map((_, k) => k).sort((a, b) => ys[a] - ys[b]);
    group.pixels = { xs: byHeight.map(k => xs[k]), ys: byHeight.map(k => ys[k]) };
  }

  // Each group's goes, first: a loose reading's word gaps are found from all of them together
  const read = [];
  for (const group of groups) {
    const holdsMain = group.parts.includes(mainBand);
    // (written with another pen: not the text, see usePen)
    if (!samePen(lineWidth(ink, width, height, group.left, group.right), mainBand.w)) {
      read.push({ group, holdsMain, gos: [null], pen: false });
      continue;
    }
    // (already read, another way)
    const centre = (group.left + group.right + 1) / 2;
    group.from = partial.find(p => Math.abs(p.x - centre) < L);
    if (group.right - group.left + 1 <= columnWidth && done.some(x => Math.abs(x - centre) < L)) {
      read.push({ group, holdsMain, gos: [], done: done.find(x => Math.abs(x - centre) < L) });
      continue;
    }
    // (the column the sizes came from is read again with the top settled, in case it starts with
    // spaces; not if it didn't read in full, though: it would only get as far again)
    const again = !(holdsMain && group.parts.length == 1 && !main.readings.length);
    const gos = group.right - group.left + 1 > columnWidth ? readTouching(group, L, top)
              : [again ? readBand(group, L, top, ['L', 'top'], holdsMain ? main.guess.x : null) : main];
    // (the column the sizes came from: read again, it may get less far, out of time say)
    if (holdsMain && gos.length == 1 && group.parts.length == 1 && (!gos[0] || progress(main) > progress(gos[0]))) gos[0] = main;
    read.push({ group, holdsMain, gos, pen: true });
  }

  // A loose reading places no spaces (see searchColumn): where its words end is found from all of
  // the picture's readings together, one of two ways.
  // - Some encoders put every letter the same step below the one before, and a word's first
  //   letter a bigger step down. Then most steps are that one size, and a word ends at a step half
  //   as big again or more.
  // - Otherwise (as here) a word ends where there's more empty space before the next character
  //   than between letters: the gaps make two groups, split as the ink is (see inkThreshold).
  const between = (chars, positions, measure) => {
    const found = [];
    let before = -1;
    chars.forEach((ch, j) => {
      if (ch == ' ' || ch == MARKER) return;
      found.push(before < 0 ? null : measure(chars[before], positions[before], ch, positions[j]));
      before = j;
    });
    return found;
  };
  const stepOf = (a, ya, b, yb) => yb - ya;
  const gapOf = (a, ya, b, yb) => (yb + letterTop(b)) - (ya + letterBottom(a));
  const everyGo = read.flatMap(({ gos }) => gos.filter(go => go))
    .map(go => [go.readings[0] ?? go.best.chars, go.placed?.[0] ?? go.best.positions]);
  const everyOne = measure => everyGo.flatMap(([chars, positions]) => between(chars, positions, measure))
    .filter(v => v != null).sort((a, b) => a - b);
  let measure = gapOf, wordBreak = 0.75;
  if (loose) {
    const steps = everyOne(stepOf);
    const counts = new Map();
    for (const step of steps) counts.set(step, (counts.get(step) ?? 0) + 1);
    const [usual, times] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    if (steps.length >= 4 && times >= 0.6 * steps.length && usual > 0) {
      measure = stepOf;
      wordBreak = usual * 1.5 - 0.01;
    } else {
      const gaps = everyOne(gapOf);
      let best = -1;
      for (let k = 1; k < gaps.length; k++) {
        const low = gaps.slice(0, k), high = gaps.slice(k);
        const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
        const split = low.length * high.length * (mean(high) - mean(low)) ** 2;
        if (split > best && mean(high) - mean(low) >= 0.5) { best = split; wordBreak = (gaps[k - 1] + gaps[k]) / 2; }
      }
      wordBreak = Math.max(wordBreak, 0.5);
    }
  }
  // The text of a loose reading, with its spaces
  const looseText = (chars, positions) => {
    const breaks = between(chars, positions, measure);
    let k = 0;
    return chars.filter(ch => ch != ' ' && ch != MARKER)
      .map(ch => (breaks[k++] > wordBreak ? ' ' : '') + textOf([ch])).join('');
  };

  const columns = [];
  for (const { group, holdsMain, gos, pen, done: x } of read) {
    if (x != null) {
      columns.push({ x, done: true });
      continue;
    }
    if (!pen) {
      columns.push({ x: (group.left + group.right + 1) / 2, read: false, skipped: true, drawing: true, readings: [], text: '', leadingSpaces: 0 });
      continue;
    }
    for (const go of gos) {
      // (never the same column twice)
      if (go && columns.some(column => Math.abs(column.x - go.guess.x) < L)) continue;
      // A mark can sit wholly on another character's lines (a dot on a letter's middle), adding
      // nothing to the picture: of the readings, only those with the fewest characters are kept.
      // And a space between two punctuation marks can draw the same as none (’ “ and ’“): of
      // readings that differ only in spaces, the one with the most is kept, as text usually has
      // them there.
      const spaced = text => text.split(' ').length;
      const drawn = text => text.replaceAll(' ', '').length;
      const all = !go ? [] : loose ? go.readings.map((chars, k) => looseText(chars, go.placed[k])) : go.readings.map(textOf);
      const fewest = Math.min(...all.map(drawn));
      const readings = [];
      for (const text of all.filter(t => drawn(t) == fewest).sort((a, b) => spaced(b) - spaced(a))) {
        if (!readings.some(kept => kept.replaceAll(' ', '') == text.replaceAll(' ', ''))) readings.push(text);
      }
      // (ink that barely reads at all is no AIDAScript, or not in the rectangle shape: a drawing
      // beside the text, say. It's left out of the text; but not the column that read best, which
      // settled the sizes: what it read is the best there is.)
      // (a loose reading is kept even if it got less far: what it read is still worth having)
      const skipped = !!go && !readings.length && progress(go) < (loose ? 0.15 : 0.5) && !(holdsMain && go === gos[0]);
      columns.push({
        x: go ? go.guess.x : null,
        read: !go || readings.length > 0,
        skipped,
        readings,
        text: go ? (readings[0] ?? partly(go.best.chars, go.best.positions)).trimEnd() : '',
        leadingSpaces: go ? go.spaces : 0,
        // (how far it got, up to its last letter: for another way to go on from. Where it got stuck
        // it was guessing, and that's usually at a mark it doesn't know, or reads wrong)
        partial: go && !readings.length ? upToLastLetter(go.best.chars, go.best.positions) : null,
      });
    }
  }
  // (an empty column between touching ones sits halfway between its neighbours)
  columns.forEach((column, k) => { column.x ??= (columns[k - 1].x + columns[k + 1].x) / 2; });
  return { text: joinColumns(columns.filter(c => !c.skipped && !c.done), L), columns, lineSize: L, sizes: { L, top, w: mainBand.w },
           unread: columns.filter(c => !c.read && !c.skipped && !c.done).length, skipped: columns.filter(c => c.skipped).length,
           timedOut: Date.now() > deadline };
}

// The line size, guessed from the horizontal strokes, for where columns touch (elsewhere a
// column's width says it better). A letter's stroke left or right is one line size long, plus
// the line width for its round ends; across a row, that makes the most common long runs of ink.
// (Runs twice as long are common too: a letter with strokes both ways, or two columns' strokes
// meeting.) Returns a few likely line sizes, the likeliest first. Only the ink from x = `left` to
// `right` counts.
function strokeLengths(ink, width, height, w, left = 0, right = width - 1){
  const counts = new Map();
  for (let y = 0; y < height; y++) {
    let x = left;
    while (x <= right) {
      if (!ink[y*width + x]) { x++; continue; }
      let end = x;
      while (end <= right && ink[y*width + end]) end++;
      if (end - x >= 2*w + 2) counts.set(end - x, (counts.get(end - x) ?? 0) + 1);
      x = end;
    }
  }
  // (a stroke's runs vary by a pixel or so from row to row: counted together with their neighbours)
  const near = length => (counts.get(length - 1) ?? 0) + 2 * (counts.get(length) ?? 0) + (counts.get(length + 1) ?? 0);
  const sizes = [];
  for (const length of [...counts.keys()].sort((a, b) => near(b) - near(a) || a - b).slice(0, 2)) {
    for (const size of [length - w, (length - w) / 2]) {
      if (size >= 3 && !sizes.some(s => Math.abs(s - size) < 1)) sizes.push(size);
    }
  }
  return sizes;
}

// Read a picture of AIDAScript every way there is, as far as each is needed (see decodePicture
// for `ink` and what comes back):
//   1. as drawn here today;
//   2. with the punctuation marks as they were drawn before (see OLD_MARKS), for older pictures;
//   3. loosely (see searchColumn), for pictures from older versions with other spacing rules, and
//      from other encoders.
// Each way only reads the columns the ways before couldn't, with the sizes they found. Each column
// says which way read it (`way`: 'today', 'old' or 'loose'). `onWay(way)`, if given, is told
// each way as it starts.
function decodeAnyHow(ink, width, height, onWay = () => {}){
  const ways = [{ way: 'today', tried: DECODE_CHARS, timeLimit: 12000 },
                { way: 'old', tried: OLD_DECODE_CHARS, timeLimit: 8000 },
                { way: 'loose', tried: OLD_DECODE_CHARS, loose: true, timeLimit: 15000 }];
  let result = null;
  for (const { way, ...options } of ways) {
    // (the sizes only if a column read in full with them: then they're right)
    const known = result?.columns.some(c => c.read && !c.skipped) ? result.sizes : null;
    // Old marks can read as today's marks that look the same: the old period (+) as a 5, the old
    // apostrophe (—) as a hyphen. A 5 right after a word, or "there-s", says the picture is an old
    // one: then every column is read the old way too, and that reading kept where it reads in full.
    const oldLooking = way == 'old' && /\p{L}5(?!\p{N})|\p{L}-[st](?!\p{L})/u.test(result.text);
    const done = known && !oldLooking ? result.columns.filter(c => c.read && !c.skipped).map(c => c.x) : [];
    // (a loose reading carries on from where a strict one got stuck: up to there, the strict one is
    // surer of itself)
    const partial = result && options.loose ? result.columns.filter(c => c.partial).map(c => ({ x: c.x, ...c.partial })) : [];
    onWay(way);
    const next = decodePicture(ink, width, height, { ...options, sizes: known, done, partial });
    for (const column of next.columns) column.way ??= way;
    result = result ? mergeReadings(result, next, oldLooking) : next;
    if (result.lineSize == null) return result;   // (no ink at all)
    // (done when every column reads, but for ink in another line width: that's no text)
    if (!result.columns.some(c => !c.drawing && (!c.read || c.skipped))) break;
  }
  // The old " (=) is drawn the same as two old apostrophes (—) half a step apart: text hardly
  // ever has two apostrophes in a row, so in a column read the old way, that's a "
  const quotes = text => text.replaceAll("''", '"');
  for (const column of result.columns) {
    if (column.way == 'today' || !column.text) continue;
    column.text = quotes(column.text);
    column.readings = column.readings.map(quotes);
  }
  result.text = joinColumns(result.columns.filter(c => !c.skipped && !c.done), result.lineSize);
  return result;
}

// A picture read two ways (see decodeAnyHow), as one: each column as the first way read it, or
// failing that the second; if neither did, whichever got further. (With `preferSecond`, as the
// second way read it where that read it in full.)
function mergeReadings(first, second, preferSecond = false){
  const L = first.lineSize ?? second.lineSize;
  const columns = first.columns.map(column => ({ ...column }));
  for (const column of second.columns) {
    if (column.done) continue;
    const k = columns.findIndex(c => Math.abs(c.x - column.x) < L);
    if (k < 0) { columns.push(column); continue; }
    const old = columns[k];
    const full = c => c.read && !c.skipped;
    // (of two partial readings, the later way's, unless it got much less far: it knows more marks)
    const better = old.drawing ? false : full(column) && (preferSecond || !full(old)) ? true : full(old) ? false
                 : (column.text?.length ?? 0) >= 0.8 * (old.text?.length ?? 0);
    if (better) columns[k] = column;
  }
  columns.sort((a, b) => a.x - b.x);
  return {
    ...first, columns,
    text: joinColumns(columns.filter(c => !c.skipped), L),
    unread: columns.filter(c => !c.read && !c.skipped).length,
    skipped: columns.filter(c => c.skipped).length,
    timedOut: first.timedOut || second.timedOut,
  };
}

// The picture's ink, split into bands from left to right where there's a gap with no ink at all
// between them: in the rectangle shape, each band is one column. Each band has its left and right
// edges and its ink pixels from top to bottom (as their middles: { xs, ys }).
function inkBands(ink, width, height){
  const counts = new Uint32Array(width);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) counts[x] += ink[y*width + x];
  const bands = [];
  for (let x = 0; x < width; x++) {
    if (!counts[x]) continue;
    const left = x;
    while (x < width && counts[x]) x++;
    bands.push({ left, right: x - 1 });
  }
  for (const band of bands) {
    const xs = [], ys = [];
    for (let y = 0; y < height; y++) {
      for (let x = band.left; x <= band.right; x++) {
        if (ink[y*width + x]) { xs.push(x + 0.5); ys.push(y + 0.5); }
      }
    }
    band.pixels = { xs, ys };
  }
  // (a few stray pixels, like a speck of dust, are no column)
  const most = Math.max(...bands.map(b => b.pixels.ys.length));
  return bands.filter(b => b.pixels.ys.length >= Math.max(4, most * 0.002));
}

// The columns' texts as one text. In the rectangle shape every line of text starts a new column,
// and so does a line that was too long for one column (it carries on in the next). Which it was
// can't be seen, so it's guessed: if the next column's first word would have fitted at the end of
// this one, without making it taller than the tallest column, the line ended here (the text had
// a line break); otherwise it was too long, and carries on (a space). An empty column between two
// others (a blank line) shows as a wider gap.
function joinColumns(columns, L){
  if (columns.length == 0) return '';
  const height = text => {
    const chars = [...drawableText(text)];
    return chars.length ? lineBottom(chars, placeLine(chars)) : 0;
  };
  const tallest = Math.max(...columns.map(c => height(c.text)));
  const gaps = columns.slice(1).map((c, k) => c.x - columns[k].x);
  const pitch = gaps.length ? Math.min(...gaps) : 0;
  let text = columns[0].text;
  for (let k = 1; k < columns.length; k++) {
    const before = columns[k - 1], column = columns[k];
    const blankLines = pitch ? Math.max(0, Math.round((column.x - before.x) / pitch) - 1) : 0;
    const firstWord = column.text.trimStart().split(' ')[0];
    const carriesOn = blankLines == 0 && column.leadingSpaces == 0 && firstWord &&
                      height(before.text + ' ' + firstWord) > tallest + 1e-9;
    text += carriesOn ? ' ' + column.text : '\n'.repeat(blankLines + 1) + ' '.repeat(column.leadingSpaces) + column.text;
  }
  return text;
}
