// Draws every letter of AIDAScript as a small SVG image for the README, using the same shapes
// as the page (the LETTERS table in layout.js), into images/letters/<letter>.svg.
//
// Run it from the project folder after changing a letter's shape:
//   node tools/make-letter-images.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'layout.js'), 'utf8');
const { LETTERS, characterSegments } = new Function(source + '\nreturn { LETTERS, characterSegments };')();

const SIZE = 64;     // the image, in pixels (square)
const STROKE = 20;   // one full stroke (from the middle out), in pixels
const WIDTH = 5;     // the line width, as on the page
const middle = SIZE / 2;

const outDir = path.join(root, 'images', 'letters');
fs.mkdirSync(outDir, { recursive: true });

for (const ch of Object.keys(LETTERS)) {
  const lines = characterSegments(ch, undefined).map(([x1, y1, x2, y2]) =>
    `  <line x1="${middle + x1 * STROKE}" y1="${middle + y1 * STROKE}" x2="${middle + x2 * STROKE}" y2="${middle + y2 * STROKE}"/>`);
  // A white tile (so the letter shows in both light and dark themes), then the two strokes
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `  <title>AIDAScript letter ${ch}</title>`,
    `  <rect x="0.5" y="0.5" width="${SIZE - 1}" height="${SIZE - 1}" rx="8" fill="#ffffff" stroke="#d0d7de"/>`,
    `  <g stroke="#000000" stroke-width="${WIDTH}" stroke-linecap="round">`,
    ...lines,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, `${ch}.svg`), svg);
}
console.log(`Drew ${Object.keys(LETTERS).length} letters into ${path.relative(root, outDir)}`);
