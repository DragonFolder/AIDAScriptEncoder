// AIDAScript tests: checks the layout and color code (layout.js, colors.js) without a browser.
// Run from the project folder:
//
//   node tests/run-tests.js            the usual checks (about half a minute)
//   node tests/run-tests.js --full     also tries every "Surprise me" combination (a few minutes)
//   node tests/run-tests.js --update   saves the current layouts as the new expected ones
//
// What's checked:
//   - Snapshots: the layouts for a set of sample texts and settings are the same as last saved
//     (tests/snapshots.json). A difference isn't always a bug: after a deliberate change to the
//     layout, look at the new results in the page, then save them with --update.
//   - The no-touching rule: lines of different columns never touch, except where the layout
//     allows it (a letter's tip exactly on the middle of another letter's line).
//   - No freezes: every layout finishes quickly, for every guide shape, stretch and rotation.
//   - The guide shapes' sums agree with each other (their outline, size and area).
//   - Random colors are always valid and readable against their background.
// The page itself (drawing, the background worker, the buttons) is checked by tests/browser.html.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const load = (file, names) =>
  new Function(fs.readFileSync(path.join(root, file), 'utf8') + `\nreturn { ${names.join(', ')} };`)();
const layout = load('layout.js', ['CONFIG', 'GUIDE_SHAPES', 'guideShape', 'compactLayouts', 'placeLine', 'wrapLine',
  'glyph', 'segmentDistance', 'meetsAtMiddle', 'columnClearance', 'drawableText', 'characterSegments', 'crossesDiamond', 'readableChar']);
const colors = load('colors.js', ['randomColors', 'contrast']);
const { CONFIG } = layout;

const FULL = process.argv.includes('--full');
const UPDATE = process.argv.includes('--update');
const SNAPSHOT_FILE = path.join(__dirname, 'snapshots.json');


// -----------------------------------------------------------------------------
// A tiny test runner
// -----------------------------------------------------------------------------

const results = [];
function test(name, fn){
  const started = Date.now();
  try {
    const note = fn();
    results.push({ name, ok: true, note, ms: Date.now() - started });
    console.log(`  ok    ${name}${note ? ' (' + note + ')' : ''}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n        ${String(error.message).split('\n').join('\n        ')}`);
  }
}
function check(condition, message){
  if (!condition) throw new Error(message);
}

const DEFAULTS = JSON.parse(JSON.stringify(CONFIG));
function settings(changes = {}){
  Object.assign(CONFIG, JSON.parse(JSON.stringify(DEFAULTS)), changes);
}

// A short fingerprint of anything that can be written as JSON (FNV-1a)
function fingerprint(value){
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}


// -----------------------------------------------------------------------------
// Sample texts and settings
// -----------------------------------------------------------------------------

const TEXTS = {
  'two words': 'hello world',
  'short': 'i love you',
  'sentence': 'the cat sat on the mat',
  'pangram': 'the quick brown fox jumps over the lazy dog. hello world?',
  'punctuation': 'wait, what? no! it\'s "fine".\nreally, it is.',
  'blank line': 'first line\n\nthird line',
  'long word': 'a supercalifragilisticexpialidocious day',
  'symbols': 'abc 123 x-y: ok',
  'numbers': `call 555 0100, room 22 or 88. "it's 2026," she said '1234567890'`,
  'long': 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua '.repeat(2),
};

const GUIDES = {
  'circle': {},
  'square': { guideShape: 'rectangle' },
  'wide rectangle, turned': { guideShape: 'rectangle', guideRatio: 1.8, guideRotation: 30 },
  'hexagon, fit to guide': { guideShape: 'hexagon', guideFit: 1 },
  'diamond, tall': { guideShape: 'diamond', guideRatio: 0.6, guideFit: 0.6 },
  'triangle, stretched and turned': { guideShape: 'triangle', guideRatio: 1.4, guideRotation: 45 },   // (used to freeze)
  'oval, upright': { guideShape: 'circle', guideRatio: 2, guideRotation: 90 },
};


// -----------------------------------------------------------------------------
// Helpers for checking a compact layout
// -----------------------------------------------------------------------------

// Every line of a compact layout, in pixels, with what it belongs to
function layoutLines(columns){
  const L = CONFIG.lineSize;
  const lines = [];
  columns.forEach((c, column) => {
    c.chars.forEach((ch, i) => {
      if (ch == ' ') return;
      const g = layout.glyph(ch, c.chars[i - 1]);
      const cx = c.x, cy = c.y + c.positions[i] * L;
      for (const [x1, y1, x2, y2] of g.segments) {
        lines.push({ column, ch, punctuation: g.punctuation, centre: [cx, cy],
                     segment: [cx + x1 * L, cy + y1 * L, cx + x2 * L, cy + y2 * L] });
      }
    });
  });
  return lines;
}

// Lines of different columns that come too close (other than a tip on another line's middle)
function touchingLines(columns){
  const lines = layoutLines(columns);
  const clearance = layout.columnClearance();
  const problems = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      if (a.column == b.column) continue;
      if (layout.segmentDistance(a.segment, b.segment) >= clearance) continue;
      const mayJoin = !a.punctuation && !b.punctuation && layout.meetsAtMiddle(a.segment, b.segment, a.centre, b.centre);
      if (!mayJoin) problems.push(`"${a.ch}" (column ${a.column + 1}) touches "${b.ch}" (column ${b.column + 1})`);
    }
  }
  return problems;
}

// Each layout's text, column by column, must be the original text: nothing lost or repeated.
// (Spaces don't count: where a line of text goes on in the next column, the column break is the
// gap between the words, so that space isn't kept.)
function textOf(columns){
  return columns.map(c => c.chars.join('')).join('').replace(/\s+/g, '');
}


// -----------------------------------------------------------------------------
// The tests
// -----------------------------------------------------------------------------

console.log('\nGuide shapes');
test('every shape, stretched and turned, agrees with itself', () => {
  let cases = 0;
  for (const name of Object.keys(layout.GUIDE_SHAPES)) {
    for (const guideRatio of [1, 0.5, 1.7, 2.5]) {
      for (const guideRotation of [0, 15, 45, 90, 135, 180]) {
        settings({ guideShape: name, guideRatio, guideRotation });
        const shape = layout.guideShape();
        let area = 0;
        const N = 1000;
        for (let i = 0; i <= N; i++) {
          const x = shape.left + (shape.right - shape.left) * i / N;
          const span = shape.span(x);
          check(span, `${name} ${guideRatio}:1 ${guideRotation}°: nothing at x = ${x}, inside its own width`);
          for (const y of span) {
            const off = Math.abs(shape.gauge(x, y) - 1);
            check(off < 1e-9, `${name} ${guideRatio}:1 ${guideRotation}°: the outline at (${x}, ${y}) measures ${shape.gauge(x, y)}, not 1`);
          }
          area += (span[1] - span[0]) * (shape.right - shape.left) / N;
        }
        check(Math.abs(area - shape.area) / shape.area < 0.01,
              `${name} ${guideRatio}:1 ${guideRotation}°: area ${area.toFixed(3)}, expected ${shape.area.toFixed(3)}`);
        check(!shape.span(shape.left - 0.01) && !shape.span(shape.right + 0.01),
              `${name} ${guideRatio}:1 ${guideRotation}°: reaches past its own left or right`);
        cases++;
      }
    }
  }
  return cases + ' cases';
});

console.log('\nCompact layouts');
const snapshots = {};
const expected = fs.existsSync(SNAPSHOT_FILE) ? JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) : null;
for (const [guideName, guide] of Object.entries(GUIDES)) {
  test(`${guideName}: every sample text keeps its words, no lines touch, layouts as expected`, () => {
    const changed = [];
    let slowest = 0;
    for (const [textName, typed] of Object.entries(TEXTS)) {
      const text = layout.drawableText(typed);   // (as the page draws it)
      settings(guide);
      const started = Date.now();
      const { layouts } = layout.compactLayouts(text.split('\n'));
      const ms = Date.now() - started;
      slowest = Math.max(slowest, ms);
      check(ms < 2000, `"${textName}" took ${ms} ms (a layout should take well under a second)`);
      check(layouts.length >= 1 && layouts[0].length > 0, `"${textName}": no layout at all`);
      layouts.forEach((columns, n) => {
        check(textOf(columns) == text.replace(/\s+/g, ''),
              `"${textName}", layout ${n + 1}: the text came out as "${textOf(columns)}"`);
        const touching = touchingLines(columns);
        check(touching.length == 0, `"${textName}", layout ${n + 1}: ${touching.slice(0, 3).join('; ')}`);
      });
      const key = `compact | ${guideName} | ${textName}`;
      snapshots[key] = layouts.map(fingerprint).join(' ');
      if (expected && expected[key] !== undefined && expected[key] != snapshots[key]) changed.push(`"${textName}"`);
    }
    check(UPDATE || !expected || changed.length == 0,
          `the layouts changed for ${changed.join(', ')}.\nIf that was on purpose, check them in the page and save them with --update.`);
    return `slowest ${slowest} ms`;
  });
}

console.log('\nRectangle layout');
test('every sample text wraps and places the same as expected', () => {
  const changed = [];
  for (const [textName, typed] of Object.entries(TEXTS)) {
    const text = layout.drawableText(typed);   // (as the page draws it)
    settings();
    const placed = text.split('\n').map(line => layout.wrapLine(line).map(chars => [chars.join(''), layout.placeLine(chars)]));
    const key = `rectangle | ${textName}`;
    snapshots[key] = fingerprint(placed);
    if (expected && expected[key] !== undefined && expected[key] != snapshots[key]) changed.push(`"${textName}"`);
  }
  check(UPDATE || !expected || changed.length == 0,
        `the columns changed for ${changed.join(', ')}.\nIf that was on purpose, check them in the page and save them with --update.`);
});

console.log('\nNo freezes');
test(`every guide shape, stretch, rotation and fit finishes quickly${FULL ? ' (all combinations)' : ''}`, () => {
  const shapes = Object.keys(layout.GUIDE_SHAPES);
  const ratios = FULL ? [1, 0.6, 0.7, 0.8, 1.2, 1.4, 1.6, 1.8] : [1, 0.6, 1.8];
  const rotations = FULL ? [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165] : [0, 45, 90, 135];
  const fits = FULL ? [0, 0.3, 0.6, 1] : [0, 1];
  const texts = FULL ? [TEXTS['two words'], TEXTS.pangram] : [TEXTS.pangram];
  let cases = 0, slowest = { ms: 0 };
  for (const text of texts) for (const guideShape of shapes) for (const guideRatio of ratios)
  for (const guideRotation of rotations) for (const guideFit of fits) {
    settings({ guideShape, guideRatio, guideRotation, guideFit });
    const started = Date.now();
    const { layouts } = layout.compactLayouts([text]);
    const ms = Date.now() - started;
    const what = `${guideShape} ${guideRatio}:1 ${guideRotation}° fit ${guideFit}`;
    check(ms < 2000, `${what} took ${ms} ms`);
    check(layouts[0].length > 0, `${what}: no layout at all`);
    if (ms > slowest.ms) slowest = { ms, what };
    cases++;
  }
  return `${cases} cases, slowest ${slowest.ms} ms (${slowest.what})`;
});

test('characters with no shape are drawn as spaces, accents are taken off', () => {
  const cases = [
    ['Hello, world!', 'Hello, world!'],
    ['room 101', 'room 101'],
    ['a#b@c', 'a b c'],
    ['12:30', '12 30'],                          // (the two numbers stay apart)
    ['2026-11-04', '2026 11 04'],
    ['Café crème', 'Cafe creme'],
    ['line 2\n8\tthree', 'line 2\n8 three'],
  ];
  for (const [text, expected] of cases) {
    const got = [...layout.drawableText(text)].map(layout.readableChar).join('');   // (stand-ins back to digits)
    check(got == expected, `${JSON.stringify(text)} gave ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  }
});

test('a number on one side of the middle line gets a middle line', () => {
  const ticked = text => [...layout.drawableText(text)].map(ch => layout.readableChar(ch) != ch ? '|' : ch).join('');
  const cases = [['4', '|'], ['6', '|'], ['71', '||'], ['369', '|||'], ['64', '64'], ['2026', '2026'],
                 ['14 2', '|| 2'], ['a4b', 'a|b'], ['1470', '1470']];
  for (const [text, expected] of cases) {
    check(ticked(text) == expected, `${JSON.stringify(text)} gave ${JSON.stringify(ticked(text))}, expected ${JSON.stringify(expected)}`);
  }
});

test('quote marks open and close; apostrophes stay apostrophes', () => {
  const cases = [
    ["don't", "don't"],
    ['don’t', "don't"],                          // (a phone's curly apostrophe)
    ["'hi'", '‘hi’'],
    ['"say \'no\'"', '“say ‘no’”'],
    ["the dogs'", "the dogs'"],                  // nothing open: an apostrophe
    ['“hi” ‘there’', '“hi” ‘there’'],
    ['"a\n"b"', '“a\n“b”'],                      // each line starts with nothing open
    ["it's 5 o'clock", "it's 5 o'clock"],
  ];
  for (const [text, expected] of cases) {
    const got = layout.drawableText(text);
    check(got == expected, `${JSON.stringify(text)} gave ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  }
});

test('digits go half a step apart where their lines allow, and no line meets a 0 except at a corner', () => {
  const digits = '1234567890';
  const strokes = (ch, y) => layout.characterSegments(ch, undefined).map(([x1, y1, x2, y2]) => [x1, y + y1, x2, y + y2]);
  const diamond = layout.crossesDiamond;
  // the rule itself, on its own
  check(diamond([-1, 0, 1, 0], 0, 0), 'a line through the middle should count');
  check(diamond([0, -0.5, 0.5, 0], 0, 0), 'a line along an edge should count');
  check(diamond([0.25, -0.25, 1, -1], 0, 0), 'a line ending on an edge should count');
  check(!diamond([0, -0.5, 0, -1], 0, 0), 'a line ending on a corner should not count');
  check(!diamond([-0.5, -0.5, 0.5, -0.5], 0, 0), 'a line just touching a corner should not count');
  for (const a of digits) for (const b of digits) {
    const [ya, yb] = layout.placeLine([a, b]);
    const step = yb - ya;
    check(step >= 0.5 && step * 2 == Math.round(step * 2), `${a}${b}: a step of ${step}`);
    if (a == '0') check(!strokes(b, yb).some(l => diamond(l, 0, ya)), `${a}${b}: the ${b} goes into the 0`);
    if (b == '0') check(!strokes(a, ya).some(l => diamond(l, 0, yb)), `${a}${b}: the ${a} goes into the 0`);
    // any two lines that meet do so in an X at both middles, or with a tip on a middle (a T)
    if (a != '0' && b != '0') {
      const middle = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];
      for (const p of strokes(a, ya)) for (const q of strokes(b, yb)) {
        if (layout.segmentDistance(p, q) > 1e-9) continue;
        const [m, n] = [middle(p), middle(q)];
        const x = Math.abs(m[0] - n[0]) < 1e-9 && Math.abs(m[1] - n[1]) < 1e-9;
        check(x || layout.meetsAtMiddle(p, q, [0, ya], [0, yb]), `${a}${b}: two lines meet away from their middles`);
      }
    }
  }
  // the second gap of some three-digit numbers, as chosen by eye
  for (const [text, gap] of [['741', 1], ['431', 0.5], ['916', 0.5], ['701', 1], ['953', 1], ['781', 1.5], ['771', 2], ['711', 1]]) {
    const p = layout.placeLine([...layout.drawableText(text)]);
    check(p[2] - p[1] == gap, `${text}: a second gap of ${p[2] - p[1]}, expected ${gap}`);
  }
  for (const [text, step] of [['71', 1], ['93', 1], ['14', 0.5], ['41', 1], ['82', 2.5], ['52', 2]]) {
    const [ya, yb] = layout.placeLine([...layout.drawableText(text)]);
    check(yb - ya == step, `${text}: a step of ${yb - ya}, expected ${step}`);
  }
  return `${digits.length ** 2} pairs`;
});


test('digits, quote marks and every punctuation mark place and draw', () => {
  for (const text of ['2026', 'call 555 0100', '1234567890', 'a1b2c3', '22 88 28 82', '“Hi,” she said. ‘5’?!']) {
    for (const line of layout.drawableText(text).split('\n')) {
      for (const chars of layout.wrapLine(line)) {
        const positions = layout.placeLine(chars);
        check(positions.every(Number.isFinite), `${JSON.stringify(text)}: a position isn't a number`);
        for (let i = 1; i < positions.length; i++) {
          check(positions[i] >= positions[i - 1], `${JSON.stringify(text)}: character ${i} goes back up`);
        }
      }
    }
  }
});

console.log('\nRandom colors');

test('every palette is valid and readable', () => {
  let worst = Infinity;
  for (let i = 0; i < 5000; i++) {
    const c = colors.randomColors();
    for (const value of [c.line, c.second, c.frame, c.background]) {
      check(/^#[0-9a-f]{6}$/.test(value), `not a color: ${value} (${c.name})`);
    }
    for (const value of [c.line, c.second, c.frame]) {
      const ratio = colors.contrast(value, c.background);
      worst = Math.min(worst, ratio);
      check(ratio >= 4.5, `${value} on ${c.background} is hard to read (contrast ${ratio.toFixed(2)}, ${c.name})`);
    }
  }
  return `5000 palettes, lowest contrast ${worst.toFixed(2)}`;
});


// -----------------------------------------------------------------------------
// Snapshots and summary
// -----------------------------------------------------------------------------

if (UPDATE || !expected) {
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshots, null, 2) + '\n');
  console.log(`\nSaved ${Object.keys(snapshots).length} expected layouts to tests/snapshots.json` +
              (expected ? '' : ' (there were none yet)'));
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} tests passed${failed.length ? ', ' + failed.length + ' FAILED' : ''}`);
process.exitCode = failed.length ? 1 : 0;
