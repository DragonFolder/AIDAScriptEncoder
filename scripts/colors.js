// =============================================================================
// AIDAScript colors: the "Random colors" generator (used by index.js, and by the tests).
// Nothing on the page here, so it can be tested on its own.
// =============================================================================

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
