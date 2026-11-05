// =============================================================================
// AIDAScript sigils: a sentence drawn as one sigil, for the Sigils page (sigils.html).
//
// Every letter of AIDAScript is two of the eight directions (flag semaphore, see LETTERS in
// layout.js, loaded first). Here the eight directions are eight points around a circle, and each
// letter is a straight line between its two points. A word is its letters' lines on one circle;
// a word that would be too crowded is broken into pieces, each on a circle of its own, stacked so
// they share a point. A sentence is its words joined line end to line end into one figure. A dot
// marks the sentence's first letter, and a short crossbar its last.
//
// No drawing and nothing on the page here, so it can run in a background worker
// (sigil-worker.js) and in the tests.
//
// Contents:
//   Sizes and shapes   – the circle, a letter's line
//   Words              – breaking a word into pieces, stacking them, tidying up
//   The marks          – the dot and the crossbar
//   Sentences          – words joined into one figure
//
// All sizes are in pixels for a circle of radius R; the page scales the drawing as it likes.
// =============================================================================


// =============================================================================
// Sizes and shapes
// =============================================================================

const SIGIL = {
  R: 50,        // the circle's radius
  LINE: 5,      // the lines' width
  DOT: 7,       // the dot's radius
  BAR: 6,       // half the crossbar's length
};

// The eight points, clockwise from the top, as directions (see layout.js)
const SIGIL_POINTS = [N, NE, E, SE, S, SW, W, NW];
const pointAngle = i => Math.atan2(SIGIL_POINTS[i][1], SIGIL_POINTS[i][0]);
const pointIndex = d => SIGIL_POINTS.findIndex(e => e[0] == d[0] && e[1] == d[1]);

// A straight line from p to q: its points (pointAt(t), t from 0 to 1), direction and length
function segment(p, q){
  const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return {
    p, q, length,
    pointAt: t => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t],
    direction: [(q[0] - p[0]) / length, (q[1] - p[1]) / length],
  };
}

// A letter's line, on the circle around (cx, cy)
function letterLine(ch, cx, cy){
  const [i, j] = LETTERS[ch].map(pointIndex);
  const at = k => [cx + SIGIL.R * Math.cos(pointAngle(k)), cy + SIGIL.R * Math.sin(pointAngle(k))];
  return segment(at(i), at(j));
}

// Points along a line (or the part of it from t0 to t1), `count` + 1 of them
const along = (s, count, t0 = 0, t1 = 1) => Array.from({ length: count + 1 }, (_, k) => s.pointAt(t0 + (t1 - t0) * k / count));

// How crowded a spot is among these lines: how close they come to it (the closer, the more)
function crowding([x, y], lines){
  let score = 0;
  for (const s of lines) for (const [px, py] of along(s, 20)) {
    const d = Math.hypot(px - x, py - y);
    if (d < 20) score += 20 - d;
  }
  return score;
}

// Do two lines run along each other (not just touch or cross)? Along one of them, a stretch longer
// than three line widths where the other runs close by (within 2.4 line widths) the same way
// (within 15°), counts
function runAlong(s, o){
  const theirs = along(o, 80);
  let run = 0, longest = 0, previous = null;
  for (const p of along(s, 60)) {
    const distance = Math.min(...theirs.map(q => Math.hypot(q[0] - p[0], q[1] - p[1])));
    const parallel = Math.abs(s.direction[0] * o.direction[1] - s.direction[1] * o.direction[0]) < 0.26;
    run = distance <= 2.4 * SIGIL.LINE && parallel && previous ? run + Math.hypot(p[0] - previous[0], p[1] - previous[1]) : 0;
    longest = Math.max(longest, run);
    previous = p;
  }
  return longest > 3 * SIGIL.LINE;
}

// Where two lines (as [p, q]) meet: [x, y, t, u] (t and u: how far along each), or null
function meeting([p1, p2], [q1, q2]){
  const d = (p2[0] - p1[0]) * (q2[1] - q1[1]) - (p2[1] - p1[1]) * (q2[0] - q1[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((q1[0] - p1[0]) * (q2[1] - q1[1]) - (q1[1] - p1[1]) * (q2[0] - q1[0])) / d;
  const u = ((q1[0] - p1[0]) * (p2[1] - p1[1]) - (q1[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t, t, u];
}

// The longest side of a triangle three lines close, or null if they close none (or meet in one point)
function triangleSize(a, b, c){
  const ab = meeting(a, b), bc = meeting(b, c), ac = meeting(a, c);
  if (!ab || !bc || !ac) return null;
  const sides = [[ab, bc], [bc, ac], [ab, ac]].map(([p, q]) => Math.hypot(p[0] - q[0], p[1] - q[1]));
  return Math.min(...sides) < 1 ? null : Math.max(...sides);
}


// =============================================================================
// Words
// =============================================================================

// A piece (letters on one circle) may be at most this crowded (see crowdedness)
const CROWDED = 40;
// No three lines in a word may close a triangle smaller than this (its longest side): it looks
// like a smudge. A word that would have one is broken into pieces instead.
const TINY = 22;

// How crowded a piece is: of every letter's line, the inner part (away from the circle's points,
// where lines always meet) is looked at in 15 spots; a spot counts if another letter's line comes
// within 0.16 R of it. The words that look good come to 40 or less.
function crowdedness(text){
  const lines = [...new Set(text)].map(ch => letterLine(ch, 0, 0));
  let close = 0;
  lines.forEach((s, i) => {
    for (let k = 3; k <= 17; k++) {
      const [x, y] = s.pointAt(k / 20);
      if (lines.some((o, j) => j != i && along(o, 40).some(([px, py]) => Math.hypot(px - x, py - y) < 0.16 * SIGIL.R))) close++;
    }
  });
  return close;
}

// Every way to break a word into pieces worth trying, best first:
// - the whole word, if it isn't too crowded;
// - pieces of two letters or more, none too crowded: the fewest pieces first, then the most even
//   in length, then the least crowded;
// - last, with one piece of a single letter (a letter whose line touches nothing in its piece
//   joins the sigil as a piece of its own: a piece always shares a point with the one before).
function splits(w){
  const found = crowdedness(w) <= CROWDED ? [[w]] : [];
  const cutsInto = (count, smallest, keep) => {
    const these = [];
    const choose = (from, left, chosen) => {
      if (left == 0) {
        const cuts = [0, ...chosen, w.length];
        const parts = cuts.slice(1).map((end, k) => w.slice(cuts[k], end));
        const key = keep(parts);
        if (key) these.push({ parts, key });
        return;
      }
      for (let cut = from; cut <= w.length - smallest * left; cut++) choose(cut + smallest, left - 1, [...chosen, cut]);
    };
    choose(smallest, count - 1, []);
    return these;
  };
  const compare = (x, y) => x.key.reduce((d, v, k) => d || v - y.key[k], 0);
  for (let count = 2; count <= Math.floor(w.length / 2) && found.length < 41; count++) {
    const these = cutsInto(count, 2, parts => {
      const scores = parts.map(crowdedness), sizes = parts.map(p => p.length);
      return Math.max(...scores) <= CROWDED && [Math.max(...sizes) - Math.min(...sizes), Math.max(...scores)];
    });
    found.push(...these.sort(compare).map(t => t.parts));
  }
  const single = [];
  for (let count = 2; count <= Math.min(4, w.length); count++) {
    single.push(...cutsInto(count, 1, parts => {
      const sizes = parts.map(p => p.length);
      return parts.filter(p => p.length == 1).length == 1 && Math.max(...parts.map(crowdedness)) <= CROWDED &&
             [count, Math.max(...sizes) - Math.min(...sizes)];
    }));
  }
  found.push(...single.sort(compare).slice(0, 40).map(t => t.parts));
  return found.length ? found : [[w]];
}

// The pieces stacked: each next piece so that one of the points its letters use sits on one of
// the points the piece before uses, the two circles overlapping well (their middles at most 1.45
// radii apart) and not onto an earlier piece; of those, where none of its lines runs along a line
// already drawn, and closest and least crowded. Returns the circles' middles, and whether every
// piece found a place with no lines running along each other.
function stack(parts){
  const R = SIGIL.R;
  const centres = [[0, 0]];
  const drawn = [...new Set(parts[0])].map(ch => letterLine(ch, 0, 0));
  const pointAt = (i, [cx, cy]) => [cx + R * Math.cos(pointAngle(i)), cy + R * Math.sin(pointAngle(i))];
  const usedPoints = letters => [...new Set([...new Set(letters)].flatMap(ch => LETTERS[ch].map(pointIndex)))];
  let clean = true;
  for (let k = 1; k < parts.length; k++) {
    let best = null;
    for (const theirs of usedPoints(parts[k - 1])) for (const mine of usedPoints(parts[k])) {
      const [jx, jy] = pointAt(theirs, centres[k - 1]);
      const cx = jx - R * Math.cos(pointAngle(mine)), cy = jy - R * Math.sin(pointAngle(mine));
      const apart = Math.hypot(cx - centres[k - 1][0], cy - centres[k - 1][1]);
      if (apart > 1.45 * R || centres.some(([x, y]) => Math.hypot(x - cx, y - cy) < 0.7 * R)) continue;
      const lines = [...new Set(parts[k])].map(ch => letterLine(ch, cx, cy));
      const runs = lines.some(s => drawn.some(o => runAlong(s, o) || runAlong(o, s)));
      let score = (runs ? 1e7 : 0) + apart / 2;
      for (const s of lines) for (const p of along(s, 20)) score += crowding(p, drawn);
      if (!best || score < best.score) best = { score, centre: [cx, cy], lines };
    }
    if (!best) {   // (no place at all: just beside the piece before)
      const [x, y] = centres[k - 1];
      best = { score: 1e7, centre: [x + R, y], lines: [...new Set(parts[k])].map(ch => letterLine(ch, x + R, y)) };
    }
    if (best.score >= 1e6) clean = false;
    centres.push(best.centre);
    drawn.push(...best.lines);
  }
  return { centres, clean };
}

// A word's lines, ready to draw: each letter once (a letter used twice is drawn once), with its
// piece, and the part of its line drawn (t0 to t1: see tidy)
function wordLines(parts, centres){
  return parts.flatMap((p, k) => [...new Set(p)].map(ch => ({ ch, piece: k, line: letterLine(ch, ...centres[k]), t0: 0, t1: 1 })));
}
const drawnPart = l => [l.line.pointAt(l.t0), l.line.pointAt(l.t1)];

// Do two drawn lines touch (or cross)?
function touching(a, b){
  const pa = along(a.line, 60, a.t0, a.t1), pb = along(b.line, 60, b.t0, b.t1);
  return pa.some(([x, y]) => pb.some(([u, v]) => Math.hypot(x - u, y - v) <= SIGIL.LINE + 0.5));
}

// The lines in groups that touch each other (by index: each line's group)
function groups(all){
  const group = all.map((_, k) => k);
  const find = k => group[k] == k ? k : (group[k] = find(group[k]));
  all.forEach((a, i) => all.forEach((b, j) => { if (i < j && touching(a, b)) group[find(i)] = find(j); }));
  return all.map((_, k) => find(k));
}
const groupCount = all => new Set(groups(all)).size;

// Does any three of the lines close a triangle smaller than TINY?
function hasTinyTriangle(all){
  const parts = all.map(drawnPart);
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (!meeting(parts[i], parts[j])) continue;
    for (let k = j + 1; k < parts.length; k++) {
      const size = triangleSize(parts[i], parts[j], parts[k]);
      if (size != null && size < TINY) return true;
    }
  }
  return false;
}

// A line end that stops just short of another line (a white gap under NEAR pixels) looks like a
// slip: the line is drawn on to meet it, if that's the smaller change, else pulled back until the
// gap is NEAR
const NEAR = 6;
function tidy(all){
  const distanceTo = (p, o) => Math.min(...along(o.line, 80, o.t0, o.t1).map(q => Math.hypot(p[0] - q[0], p[1] - q[1])));
  for (const l of all) {
    for (const end of [0, 1]) {
      const t = end == 0 ? l.t0 : l.t1, p = l.line.pointAt(t);
      for (const o of all) {
        if (o === l) continue;
        const gap = distanceTo(p, o) - SIGIL.LINE;
        if (gap <= 0.5 || gap >= NEAR) continue;
        let meet = null;   // (drawn on: how far along until it meets the other)
        const step = 0.5 / l.line.length, dir = end == 0 ? -1 : 1;
        for (let u = t, k = 0; k < 4 * (gap + 2); k++, u += dir * step) {
          if (distanceTo(l.line.pointAt(u), o) <= SIGIL.LINE - 1) { meet = u; break; }
        }
        if (meet != null && Math.abs(meet - t) * l.line.length <= NEAR - gap) {
          if (end == 0) l.t0 = meet; else l.t1 = meet;
        } else {
          const back = (NEAR - gap) / l.line.length;
          if (end == 0) l.t0 = Math.min(l.t0 + back, 0.45); else l.t1 = Math.max(l.t1 - back, 0.55);
        }
        break;
      }
    }
  }
}

// Any group of lines that touches nothing else is joined to the biggest group by a short stroke,
// the shortest way between them
function connect(all){
  for (let round = 0; round < 10; round++) {
    const group = groups(all);
    const sizes = new Map();
    for (const g of group) sizes.set(g, (sizes.get(g) ?? 0) + 1);
    if (sizes.size < 2) return;
    const main = [...sizes].sort((a, b) => b[1] - a[1])[0][0], other = [...sizes.keys()].find(g => g != main);
    let best = null;
    all.forEach((a, i) => { if (group[i] != other) return;
      all.forEach((b, j) => { if (group[j] != main) return;
        for (const p of along(a.line, 40, a.t0, a.t1)) for (const q of along(b.line, 40, b.t0, b.t1)) {
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (!best || d < best.d) best = { d, p, q };
        }
      });
    });
    all.push({ ch: null, piece: -1, line: segment(best.p, best.q), t0: 0, t1: 1 });
  }
}

// A word as a sigil: the first way of breaking it (see splits) that stacks cleanly, has no tiny
// triangle, makes one figure, and has room for both marks; failing that, the one that comes closest
// (in that order of importance), with any loose group joined on by a stroke (see connect).
// Returns its lines ([p, q] each), which are its first and last letter's, and how it was broken.
// `variant`: the first (0), or the second, third... way of breaking it that's as good: for other
// layouts (see sigilLayouts). Null if there isn't that many.
const wordCache = new Map();
function sigilWord(w, variant = 0){
  const key = `${w}#${variant}`;
  if (wordCache.has(key)) return wordCache.get(key);
  let chosen = null, good = 0;
  for (const split of splits(w).slice(0, 80)) {
    const parts = split.map(p => [...p]);
    const { centres, clean } = stack(parts);
    if (!clean && chosen) continue;
    const all = wordLines(parts, centres);
    tidy(all);
    const first = all.find(l => l.piece == 0 && l.ch == parts[0][0]);
    const last = all.find(l => l.piece == parts.length - 1 && l.ch == parts.at(-1).at(-1));
    const rank = (clean ? 8 : 0) + (hasTinyTriangle(all) ? 0 : 4) + (groupCount(all) == 1 ? 2 : 0) + (marks(all, first, last).clear ? 1 : 0);
    if (rank == 15 && good++ < variant) continue;   // (an earlier variant's)
    if (!chosen || rank > chosen.rank) chosen = { rank, split, all, first, last, centres };
    if (rank == 15) break;
  }
  if (variant > 0 && chosen?.rank != 15) { wordCache.set(key, null); return null; }
  connect(chosen.all);
  // Which letters of the word a line stands for: where its letter is in its piece (a letter used
  // twice in a piece is one line); none for a stroke that joins groups (see connect)
  const starts = chosen.split.map((_, k) => chosen.split.slice(0, k).join('').length);
  const lettersOf = l => l.ch == null ? [] :
    [...chosen.split[l.piece]].flatMap((ch, i) => ch == l.ch ? [starts[l.piece] + i] : []);
  const result = {
    pieces: chosen.split,
    circles: chosen.centres,   // (each piece's circle's middle: for showing the circles as a guide)
    lines: chosen.all.map(l => ({ ends: drawnPart(l), first: l === chosen.first, last: l === chosen.last, letters: lettersOf(l), piece: l.piece })),
  };
  wordCache.set(key, result);
  return result;
}


// =============================================================================
// The marks
// =============================================================================

// The dot (on the first letter's line) and the crossbar (across the last letter's), each on its own
// line, where neither comes near any other line (GAP pixels clear, beyond both widths), nor each
// other: as near a quarter of the way along as can be (the less crowded end first), then step by
// step towards the middle and the other end; failing that, the same at a smaller size; failing that,
// wherever has the most room. `all` are the lines ({ line, t0, t1 }).
const GAP = 3;
function marks(all, first, last){
  const others = own => all.filter(l => l !== own);
  // how much room a mark (as points) has from every other line
  const room = (points, own) => Math.min(...others(own).map(l =>
    Math.min(...along(l.line, 80, l.t0, l.t1).flatMap(([x, y]) => points.map(([px, py]) => Math.hypot(px - x, py - y)))) - SIGIL.LINE / 2));
  const barAt = (l, t, half) => {
    const [bx, by] = l.line.pointAt(t), [ux, uy] = l.line.direction;
    return [[bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]];
  };
  const barPoints = ([[x1, y1], [x2, y2]]) => Array.from({ length: 7 }, (_, k) => [x1 + (x2 - x1) * k / 6, y1 + (y2 - y1) * k / 6]);
  const dotPoints = ([x, y], r) => Array.from({ length: 12 }, (_, k) => [x + r * Math.cos(k * Math.PI / 6), y + r * Math.sin(k * Math.PI / 6)]);
  const spots = l => {
    const lines = others(l).map(o => o.line);
    const quiet = [0.25, 0.75].sort((a, b) => crowding(l.line.pointAt(a), lines) - crowding(l.line.pointAt(b), lines));
    const list = [];
    for (let step = 0; step <= 0.4 + 1e-9; step += 0.025) for (const q of quiet) for (const t of [q + step, q - step]) {
      if (t >= Math.max(0.08, l.t0) && t <= Math.min(0.92, l.t1) && !list.some(u => Math.abs(u - t) < 1e-9)) list.push(t);
    }
    return list;
  };
  const enough = 2 + GAP;   // (2: half the mark's own line)
  const place = (line, roomAt) => {
    let best = null;
    for (const size of [1, 0.7]) {
      for (const t of spots(line)) {
        const r = roomAt(t, size);
        if (r >= enough) return { t, size, clear: true };
        if (size < 1 && (!best || r > best.r)) best = { t, size, r, clear: false };
      }
    }
    return best ?? { t: 0.5, size: 0.7, clear: false };
  };
  const d = place(first, (t, size) => room(dotPoints(first.line.pointAt(t), SIGIL.DOT * size), first) - 1);   // (1: the dot's edge)
  const dot = { at: first.line.pointAt(d.t), r: SIGIL.DOT * d.size };
  const b = place(last, (t, size) => {
    const points = barPoints(barAt(last, t, SIGIL.BAR * size));
    return Math.min(room(points, last), Math.min(...points.map(([x, y]) => Math.hypot(x - dot.at[0], y - dot.at[1]))) - dot.r - 2);
  });
  return { dot, bar: barAt(last, b.t, SIGIL.BAR * b.size), clear: d.clear && b.clear };
}


// =============================================================================
// Sentences
// =============================================================================

// Joining a word to a sentence keeps it open: between the word and the rest, no triangle smaller
// than SENTENCE_TRIANGLE (stricter than within a word), and no more crossings than the spread
// allows (see sigilOf)
const SENTENCE_TRIANGLE = 35;

// What joining `added` lines ([p, q]) to `old` ones adds: the smallest triangle that lines from both
// close, and how many times the new lines cross the old (ends meeting don't count)
function openness(old, added){
  const all = [...old, ...added], isNew = k => k >= old.length;
  let smallest = Infinity, crossings = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const m = meeting(all[i], all[j]);
    if (!m) continue;
    if (isNew(i) != isNew(j) && m[2] > 0.05 && m[2] < 0.95 && m[3] > 0.05 && m[3] < 0.95) crossings++;
    for (let k = j + 1; k < all.length; k++) {
      if (isNew(i) == isNew(j) && isNew(j) == isNew(k)) continue;   // (all within one: not ours to judge)
      const size = triangleSize(all[i], all[j], all[k]);
      if (size != null) smallest = Math.min(smallest, size);
    }
  }
  return { smallest, crossings };
}

// The words of a text: letters only (accents taken off, upper case as lower), anything else ends a
// word, except an apostrophe inside one (don't is one word)
function sigilWords(text){
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’](?=\p{L})/gu, '')
    .split(/[^a-z]+/).filter(w => w);
}

// A sentence as one sigil, or null if it has no letters. Each word (see sigilWord) is joined to the
// figure so far the way pieces join: one of its line ends on a line end already drawn, wherever
// makes the figure smallest, with no line running along another, no small triangle, and at most
// `crossings` crossings per line of the word (spread 0 to 1: from tight, 1 crossing per line, to
// open, none). Then the dot and the crossbar (see marks).
// Returns { lines: [[p, q], ...], dot: { at, r }, bar: [p, q], box: { x, y, width, height }, circles,
//           words, owners }
// (words: the sentence's words, as drawn; owners: for each line, { word, letters, circle }: which word
// it's in, which of its letters it stands for, and which circle it's on, none for a joining stroke)
// (circles: every piece's circle's middle, for showing them as a guide; the box doesn't take them in).
// `choices` (for other layouts, see sigilLayouts): for each word, which way of breaking it
// (variants[k], see sigilWord) and which of its places (places[k]: 0 the best, 1 the next best...);
// null if a word hasn't that many.
function sigilOf(text, { spread = 0.7, choices = null } = {}){
  const texts = sigilWords(text);
  if (!texts.length) return null;
  const words = texts.map((w, k) => sigilWord(w, choices?.variants[k] ?? 0));
  if (words.some(w => !w)) return null;
  const allowed = 1 - spread;
  // (the k-th word's lines, moved; the same word twice is the same result, see sigilWord: k tells them apart)
  const moved = (k, dx, dy) => words[k].lines.map(l => ({ ...l, word: k, ends: l.ends.map(([x, y]) => [x + dx, y + dy]) }));
  let figure = moved(0, 0, 0);
  const circles = [...words[0].circles];
  const firstCircle = [0];   // (where each word's circles start in `circles`)
  for (let k = 1; k < words.length; k++) {
    const word = words[k];
    const anchors = new Map(), mine = new Map();
    for (const l of figure) for (const p of l.ends) anchors.set(p.map(Math.round).join(), p);
    for (const l of word.lines) for (const p of l.ends) mine.set(p.map(Math.round).join(), p);
    const old = figure.map(l => l.ends), oldLines = old.map(([p, q]) => segment(p, q));
    const xs = old.flat().map(p => p[0]), ys = old.flat().map(p => p[1]);
    const place = choices?.places[k] ?? 0;
    let best = null;
    const all = [];   // (every place tried, when not the best one is wanted)
    const tried = new Set();
    for (const [ax, ay] of anchors.values()) for (const [mx, my] of mine.values()) {
      const dx = ax - mx, dy = ay - my, key = `${Math.round(dx)},${Math.round(dy)}`;
      if (tried.has(key)) continue;   // (the same place, by another pair of ends)
      tried.add(key);
      const placed = moved(k, dx, dy), added = placed.map(l => l.ends);
      const px = added.flat().map(p => p[0]), py = added.flat().map(p => p[1]);
      const size = Math.max(...xs, ...px) - Math.min(...xs, ...px) + Math.max(...ys, ...py) - Math.min(...ys, ...py);
      if (place == 0 && best && best.faults == 0 && size >= best.size) continue;   // (can't do better: skip the checks)
      const runs = added.some(([p, q]) => oldLines.some(o => runAlong(segment(p, q), o) || runAlong(o, segment(p, q))));
      const look = openness(old, added);
      const faults = (runs ? 4 : 0) + (look.smallest < SENTENCE_TRIANGLE ? 2 : 0) + (look.crossings > allowed * added.length + 1e-9 ? 1 : 0);
      const candidate = { faults, size, placed, dx, dy };
      if (place > 0) all.push(candidate);
      if (!best || faults < best.faults || (faults == best.faults && size < best.size)) best = candidate;
    }
    if (place > 0) {
      // (the place-th best of the places as good as the best: as few faults, the smallest first)
      const good = all.filter(c => c.faults == best.faults).sort((a, b) => a.size - b.size);
      if (place >= good.length) return null;
      best = good[place];
    }
    figure = [...figure, ...best.placed];
    firstCircle.push(circles.length);
    circles.push(...word.circles.map(([x, y]) => [x + best.dx, y + best.dy]));
  }
  const all = figure.map(l => ({ line: segment(...l.ends), t0: 0, t1: 1 }));
  const first = all[figure.findIndex(l => l.first)], last = all[figure.length - 1 - [...figure].reverse().findIndex(l => l.last)];
  const marked = marks(all, first, last);
  const points = [...figure.flatMap(l => l.ends), ...marked.bar,
                  ...[[-1, 0], [1, 0], [0, -1], [0, 1]].map(([u, v]) => [marked.dot.at[0] + u * marked.dot.r, marked.dot.at[1] + v * marked.dot.r])];
  const pad = SIGIL.LINE;
  const x = Math.min(...points.map(p => p[0])) - pad, y = Math.min(...points.map(p => p[1])) - pad;
  return {
    lines: figure.map(l => l.ends), dot: marked.dot, bar: marked.bar, circles,
    words: sigilWords(text),
    owners: figure.map(l => ({ word: l.word, letters: l.letters, circle: l.piece >= 0 ? firstCircle[l.word] + l.piece : null })),
    box: { x, y, width: Math.max(...points.map(p => p[0])) + pad - x, height: Math.max(...points.map(p => p[1])) + pad - y },
  };
}


// Different layouts of a sentence, one at a time: layout(0) is sigilOf's, and each next one the next
// different one found by changing as little as can be (one word's place or way of breaking first,
// then two...). layout(n) is null once there are no more. They're kept, so stepping back is quick.
class SigilLayouts {
  constructor(text, spread = 0.7){
    this.text = text;
    this.spread = spread;
    this.found = [];
    this.seen = new Set();
    this.words = sigilWords(text).length;
    this.choices = this.allChoices();
  }
  // Every set of choices to try, from the least changed: for each word, which way of breaking it and
  // which place (the first word has no place to choose: it's where the others join)
  *allChoices(){
    const n = this.words, slots = [];
    for (let k = 0; k < n; k++) slots.push(['variants', k]);
    for (let k = 1; k < n; k++) slots.push(['places', k]);
    const make = changes => {
      const choices = { variants: Array(n).fill(0), places: Array(n).fill(0) };
      for (const [[kind, k], value] of changes) choices[kind][k] = value;
      return choices;
    };
    yield make([]);
    for (let value = 1; value <= 4; value++) for (const slot of slots) yield make([[slot, value]]);
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
      for (let a = 1; a <= 2; a++) for (let b = 1; b <= 2; b++) yield make([[slots[i], a], [slots[j], b]]);
    }
  }
  layout(n){
    while (this.found.length <= n) {
      const next = this.choices.next();
      if (next.done) return null;
      const sigil = sigilOf(this.text, { spread: this.spread, choices: next.value });
      if (!sigil) continue;
      const key = JSON.stringify(sigil.lines.map(l => l.flat().map(Math.round)).sort());
      if (this.seen.has(key)) continue;   // (the same as one found already)
      this.seen.add(key);
      this.found.push(sigil);
    }
    return this.found[n];
  }
}

// Every line of a text in layout `n` (a line with fewer layouts in its last one), with `kept`
// holding each line's layouts (a Map, kept between calls). Returns { sigils, more }: more is
// false if no line had layout n.
function sigilsInLayout(lines, n, kept){
  let more = false;
  const sigils = lines.map(line => {
    if (!kept.has(line)) kept.set(line, new SigilLayouts(line));
    const layouts = kept.get(line), sigil = layouts.layout(n);
    if (sigil) more = true;
    return sigil ?? layouts.found.at(-1) ?? null;
  });
  return { sigils, more };
}
