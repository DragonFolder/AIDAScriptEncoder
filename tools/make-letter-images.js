// Draws every letter, digit and punctuation mark of AIDAScript as a small SVG image for the README,
// using the same shapes as the page (the LETTERS, DIGITS and PUNCTUATION tables in layout.js):
//   images/letters/<letter>.svg
//   images/digits/<digit>.svg
//   images/punctuation/<name>.svg   (see PUNCTUATION_NAMES: "?" can't be part of a file name)
//
// Run it from the project folder after changing a shape:
//   node tools/make-letter-images.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'layout.js'), 'utf8');
const { LETTERS, PUNCTUATION, TICKED, characterSegments } =
  new Function(source + '\nreturn { LETTERS, PUNCTUATION, TICKED, characterSegments };')();
const DIGITS = '1234567890';   // (all drawn from the PUNCTUATION table)

const SIZE = 64;     // the image, in pixels (square)
const STROKE = 20;   // one full stroke (from the middle out), in pixels: the same for every image,
                     // so the punctuation marks keep their size next to the letters
const WIDTH = 5;     // the line width, as on the page
const middle = SIZE / 2;

const PUNCTUATION_NAMES = {
  '.': 'period', ',': 'comma', "'": 'apostrophe', '’': 'closing-single-quote',
  '“': 'opening-quote', '”': 'closing-quote', '?': 'question', '!': 'exclamation',
  '-': 'hyphen', ':': 'colon', ';': 'semicolon', '(': 'opening-parenthesis', ')': 'closing-parenthesis',
  '/': 'slash',
};
// Drawn the same as another mark: no picture of their own
const SAME_AS = { '‘': "'", '"': '“' };   // (and the digits, which are drawn into images/digits)

// One character as an SVG: a white tile (so it shows in both light and dark themes), then its lines
function drawing(ch, title){
  const lines = characterSegments(ch, undefined).map(([x1, y1, x2, y2]) =>
    `  <line x1="${middle + x1 * STROKE}" y1="${middle + y1 * STROKE}" x2="${middle + x2 * STROKE}" y2="${middle + y2 * STROKE}"/>`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `  <title>${title}</title>`,
    `  <rect x="0.5" y="0.5" width="${SIZE - 1}" height="${SIZE - 1}" rx="8" fill="#ffffff" stroke="#d0d7de"/>`,
    `  <g stroke="#000000" stroke-width="${WIDTH}" stroke-linecap="round">`,
    ...lines,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

function save(folder, name, svg){
  const dir = path.join(root, 'images', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.svg`), svg);
}

for (const ch of Object.keys(LETTERS)) save('letters', ch, drawing(ch, `AIDAScript letter ${ch}`));
for (const ch of DIGITS) save('digits', ch, drawing(ch, `AIDAScript digit ${ch}`));
let marks = 0;
for (const ch of Object.keys(PUNCTUATION)) {
  // (digits go into images/digits; the stand-ins for digits with a middle line aren't marks of their own)
  if (SAME_AS[ch] || DIGITS.includes(ch) || Object.hasOwn(TICKED, ch)) continue;
  const name = PUNCTUATION_NAMES[ch];
  if (!name) throw new Error(`No file name for the punctuation mark ${ch}: add it to PUNCTUATION_NAMES`);
  save('punctuation', name, drawing(ch, `AIDAScript ${name.replaceAll('-', ' ')} (${ch})`));
  marks++;
}
// (a picture whose mark is gone, e.g. the old quote.svg, is left for you to delete)
console.log(`Drew ${Object.keys(LETTERS).length} letters into images/letters, ${DIGITS.length} digits into ` +
            `images/digits and ${marks} punctuation marks into images/punctuation`);
