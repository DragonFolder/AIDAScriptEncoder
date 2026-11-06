// =============================================================================
// AIDAScript Sigils page: turns each line of the text into a sigil (see sigil.js, loaded first).
//
// The sigils are worked out in a background worker (sigil-worker.js), so the page stays
// responsive with long text; without a worker (some browsers don't allow one for a page opened
// straight from a file), on the page. They're kept for the text and layout they were made for, so
// changing a color only draws them again.
//
// The settings are remembered for the next visit; the text isn't, and the downloads don't carry
// it either: a sigil is meant to keep its sentence to itself.
// =============================================================================

const byId = id => document.getElementById(id);
const SCRIPT = document.currentScript.src;          // (this file's address: the worker is next to it)
const VERSION = new URL(SCRIPT).search;               // (the page's ?v=, for the workers too)
const NS = 'http://www.w3.org/2000/svg';
const input = byId('sigilText');
const preview = byId('sigilPreview');
const SETTINGS = ['setSigilLine', 'setSigilBg', 'setSigilTransparent', 'setSigilMarks', 'setSigilOutline', 'setSigilGuides'];
const SETTINGS_KEY = 'aidascript.sigilSettings';

function settings(){
  return {
    size: 50,   // (the circle's size, in pixels: the zoom makes the preview bigger or smaller)
    line: byId('setSigilLine').value,
    background: byId('setSigilBg').value,
    transparent: byId('setSigilTransparent').checked,
    marks: byId('setSigilMarks').checked,      // the dot and the crossbar
    outline: byId('setSigilOutline').checked,  // a thin edge around the dot, in the background color
  };
}


// -----------------------------------------------------------------------------
// Working out the sigils (in the background)
// -----------------------------------------------------------------------------

let worker = null, onPage = false;
let request = 0;                       // the latest request: replies to older ones are dropped
let waiting = null;                    // what to do with the reply to the latest request
let made = { key: null, sigils: [] };  // the sigils for the text and layout they were made for
let layout = 0;                        // which layout is shown (0: the first, see SigilLayouts)
let noMore = false;                    // (no layout after this one)
let asked = 0;                         // (the layout last asked for, while it's worked out)
let total = null;                      // how many layouts the text has (null: still counting)
let counter = null, counting = null;   // (the worker counting them, and for which text)
const keptOnPage = new Map();          // (each line's layouts, without a worker)

// Work out the sigils for the text in `layout` (asked: `wanted`, a layout that may not exist)
function workOut(wanted = layout){
  const lines = input.value.split('\n');
  const key = JSON.stringify([lines, wanted]);
  asked = wanted;
  if (key == made.key) { draw(); return; }
  const id = ++request;
  byId('sigilBusy').hidden = false;
  const done = ({ sigils, more }) => {
    if (id != request) return;
    byId('sigilBusy').hidden = true;
    if (!more && wanted > 0) {   // (there's no such layout: stay on this one, and say so)
      noMore = true;
      asked = layout;
      showLayout();
      return;
    }
    layout = wanted;
    noMore = false;
    made = { key, sigils };
    showLayout();
    draw();
  };
  waiting = done;
  if (!onPage && !worker) {
    try {
      worker = new Worker(new URL('sigil-worker.js' + VERSION, SCRIPT));
      worker.onmessage = ({ data }) => { if (data.id == request) waiting(data); };
      worker.onerror = event => {   // (it didn't start: from now on, on the page)
        event.preventDefault();
        worker = null;
        onPage = true;
        workOut(wanted);
      };
    } catch {
      onPage = true;
    }
  }
  if (worker) {
    worker.postMessage({ id, lines, layout: wanted });
  } else {
    setTimeout(() => done(sigilsInLayout(lines, wanted, keptOnPage)), 20);   // (after "Drawing…" has shown)
  }
}

// Count the text's layouts, in a worker of its own (it can take a while for a long sentence, and
// shouldn't hold up the drawing); a new text stops the count for the old one. Without workers (as
// when the page is opened straight from a file), it's counted on the page, a little at a time.
function countLayouts(){
  const lines = input.value.split('\n'), key = JSON.stringify(lines);
  if (key == counting) return;
  counting = key;
  total = null;
  counter?.terminate();
  counter = null;
  const counted = n => {
    if (key != counting) return;
    total = Math.max(1, n);
    showLayout();
  };
  if (!onPage) {
    try {
      counter = new Worker(new URL('sigil-worker.js' + VERSION, SCRIPT));
      counter.onmessage = ({ data }) => { if (data.id == key) counted(data.total); };
      counter.onerror = event => { event.preventDefault(); counter = null; countOnPage(key, lines, counted); };
      counter.postMessage({ id: key, lines, count: true });
    } catch {
      counter = null;
    }
  }
  if (!counter) countOnPage(key, lines, counted);
  showLayout();
}

// (on the page: a few milliseconds' work at a time, so it stays responsive)
function countOnPage(key, lines, counted){
  const layoutsOf = line => {
    if (!keptOnPage.has(line)) keptOnPage.set(line, new SigilLayouts(line));
    return keptOnPage.get(line);
  };
  const tick = () => {
    if (key != counting) return;   // (the text changed)
    const end = performance.now() + 15;
    while (performance.now() < end) {
      const left = lines.find(line => !layoutsOf(line).done);
      if (left === undefined) {
        counted(Math.max(0, ...lines.map(line => layoutsOf(line).found.length)));
        return;
      }
      layoutsOf(left).step();
    }
    setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
}

// ‹ Layout n / total ›: step through the layouts (see SigilLayouts); a new text starts at the first
function showLayout(){
  const last = noMore || (total != null && layout + 1 >= total);
  byId('sigilLayoutLabel').textContent = `Layout ${layout + 1} / ${total ?? '…'}`;
  byId('sigilLayoutLabel').title = total == null ? 'Counting the layouts…' : '';
  byId('sigilLayoutPrev').disabled = layout == 0;
  byId('sigilLayoutNext').disabled = last;
  byId('sigilLayoutNext').title = last ? 'No more layouts' : 'Try another layout';
}
byId('sigilLayoutPrev').onclick = () => workOut(Math.max(0, asked - 1));
byId('sigilLayoutNext').onclick = () => workOut(asked + 1);

// While typing, wait for a short pause first
let typingTimer = null;
input.addEventListener('input', () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { layout = 0; noMore = false; countLayouts(); workOut(0); }, 250);
});


// -----------------------------------------------------------------------------
// Drawing
// -----------------------------------------------------------------------------

let svg = null;   // the drawing now in the preview (for the downloads)

// The sigils side by side (sigil sizes, in pixels for a circle of radius SIGIL.R), scaled to the size
// asked for, in the colors asked for, as SVG text. Null if there's nothing to draw.
// For the preview only, never downloaded:
// - with `guides`, each circle's octagon is drawn faintly behind (the picture grows to show them whole);
// - with `pointing`, every line gets a wider, invisible copy on top, to point at (see showLetters).
// With `upTo`, only what's written by then (see writing): for the animation.
function picture(guides, pointing = false, upTo = null){
  const { size, line, background, transparent, marks, outline } = settings();
  const sigils = made.sigils.filter(s => s);
  if (!sigils.length) return null;
  const order = upTo == null ? null : writing(sigils);
  const gap = SIGIL.R, pad = SIGIL.R * 0.4;
  const height = Math.max(...sigils.map(s => s.box.height));
  const octagon = ([cx, cy]) => SIGIL_POINTS.map((_, i) => [cx + SIGIL.R * Math.cos(pointAngle(i)), cy + SIGIL.R * Math.sin(pointAngle(i))]);
  let x = pad, body = '', guide = '', hits = '';
  const corners = [];   // (the guides' corners, where they're drawn)
  sigils.forEach((s, k) => {
    const dx = x - s.box.x, dy = pad + (height - s.box.height) / 2 - s.box.y;
    if (pointing) hits += `<g transform="translate(${dx},${dy})">` + s.lines.map(([[x1, y1], [x2, y2]], i) =>
      `<line class="hit" data-sigil="${k}" data-line="${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('') + '</g>';
    let lines, dotShown = true, barShown = true;
    if (!order) {
      lines = s.lines.map(([[x1, y1], [x2, y2]]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('');
    } else {   // (each line as far as it's written: from where the pen starts, `done` of the way)
      const steps = order.steps.filter(step => step.sigil == k);
      const done = step => Math.min(1, Math.max(0, upTo - step.at));
      lines = steps.map(step => {
        const f = done(step);
        if (f <= 0) return '';
        const [[x1, y1], [x2, y2]] = step.reverse ? [...s.lines[step.line]].reverse() : s.lines[step.line];
        return `<line x1="${x1}" y1="${y1}" x2="${x1 + (x2 - x1) * f}" y2="${y1 + (y2 - y1) * f}"/>`;
      }).join('');
      dotShown = done(steps.find(step => step.first) ?? steps[0]) >= 1;
      barShown = steps.every(step => done(step) >= 1);
    }
    const [[b1, b2], [b3, b4]] = s.bar;
    // (the dot can get a thin edge in the background color, to stand apart from lines near it)
    const edge = outline && !transparent ? ` stroke="${background}" stroke-width="2"` : '';
    const marked = !marks ? '' :
      (barShown ? `<line x1="${b1}" y1="${b2}" x2="${b3}" y2="${b4}" stroke="${line}" stroke-width="4" stroke-linecap="round"/>` : '') +
      (dotShown ? `<circle cx="${s.dot.at[0]}" cy="${s.dot.at[1]}" r="${s.dot.r}" fill="${line}"${edge}/>` : '');
    if (guides) {
      for (const centre of s.circles) {
        const points = octagon(centre);
        corners.push(...points.map(([u, v]) => [u + dx, v + dy]));
        guide += `<polygon points="${points.map(p => p.join(',')).join(' ')}" transform="translate(${dx},${dy})"/>`;
      }
    }
    body += `<g transform="translate(${dx},${dy})">` +
      `<g stroke="${line}" stroke-width="${SIGIL.LINE}" stroke-linecap="round">${lines}</g>${marked}</g>`;
    x += s.box.width + gap;
  });
  const width = x - gap + pad, full = height + 2 * pad, scale = size / SIGIL.R;
  const room = 4;
  const x0 = Math.min(0, ...corners.map(p => p[0] - room)), y0 = Math.min(0, ...corners.map(p => p[1] - room));
  const x1 = Math.max(width, ...corners.map(p => p[0] + room)), y1 = Math.max(full, ...corners.map(p => p[1] + room));
  const back = transparent ? '' : `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${background}"/>`;
  const guideLayer = guide && `<g class="guide" fill="none" stroke="${line}" stroke-opacity="0.3" stroke-width="1.5" stroke-dasharray="4 4">${guide}</g>`;
  return `<svg xmlns="${NS}" width="${(x1 - x0) * scale}" height="${(y1 - y0) * scale}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}">` +
         `${back}${guideLayer}${body}` +
         (pointing ? `<g class="pointing"></g><g class="hits" stroke="transparent" stroke-width="16" stroke-linecap="round">${hits}</g>` : '') +
         `</svg>`;
}

// The order the lines are written in, for the animation: sigil by sigil, each line when its
// first letter comes up in the sentence (a letter used again was drawn already), and a stroke
// that only joins two groups once both are there. The pen starts each line at the end nearest
// where it left off. Returns { steps: [{ sigil, line, reverse, first, at }], total }: a step is
// written from `at` to `at` + 1 (`first`: the first letter's line, which carries the dot).
function writing(sigils){
  const steps = [];
  sigils.forEach((s, k) => {
    const near = (p, [[x1, y1], [x2, y2]]) => {   // (how far a point is from a line)
      const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
    };
    const keys = s.lines.map((_, i) => {
      const { word, letters } = s.owners[i];
      return letters.length ? word * 1000 + Math.min(...letters) : null;
    });
    // (a joining stroke: right after the later of the two groups it joins has started)
    const keyed = s.lines.map((l, i) => {
      if (keys[i] != null) return keys[i];
      const ends = l.map(p => Math.min(...keys.map((key, j) => key != null && near(p, s.lines[j]) < 1.5 ? key : Infinity)));
      return Math.max(...ends.filter(e => e < Infinity), -1) + 0.5;
    });
    const firstKey = Math.min(...keys.filter(key => key != null));
    let pen = null;
    for (const i of s.lines.map((_, i) => i).sort((a, b) => keyed[a] - keyed[b])) {
      const [p, q] = s.lines[i];
      const reverse = pen ? Math.hypot(q[0] - pen[0], q[1] - pen[1]) < Math.hypot(p[0] - pen[0], p[1] - pen[1]) : false;
      pen = reverse ? p : q;
      steps.push({ sigil: k, line: i, reverse, first: keys[i] == firstKey, at: steps.length });
    }
  });
  return { steps, total: steps.length };
}

// Pointing at a line (or tapping it) shows which letters it stands for: the line in the accent
// color, and its word, with those letters marked (a letter used twice in a piece is one line; a
// stroke that only joins two groups stands for none)
const letterLabel = document.createElement('div');
letterLabel.className = 'sigil-label';
document.body.append(letterLabel);
let pointedAt = null;
function showLetters(hit, event){
  const sigil = made.sigils.filter(s => s)[Number(hit.dataset.sigil)], i = Number(hit.dataset.line);
  if (!sigil) return;
  const { word, letters } = sigil.owners[i];
  if (pointedAt !== hit) {
    pointedAt = hit;
    const layer = svg.querySelector('.pointing');
    layer.replaceChildren();
    const copy = hit.cloneNode();
    copy.removeAttribute('class');
    copy.style.stroke = 'var(--accent)';   // (as a style: an SVG attribute can't use a CSS variable)
    copy.setAttribute('stroke-width', SIGIL.LINE + 1);
    copy.setAttribute('stroke-linecap', 'round');
    const moved = document.createElementNS(NS, 'g');
    moved.setAttribute('transform', hit.parentNode.getAttribute('transform'));
    // (and the octagon of the circle it's on, dashed, behind it)
    const circle = sigil.owners[i].circle;
    if (circle != null) {
      const [cx, cy] = sigil.circles[circle];
      const octagon = document.createElementNS(NS, 'polygon');
      octagon.setAttribute('points', SIGIL_POINTS.map((_, k) =>
        `${cx + SIGIL.R * Math.cos(pointAngle(k))},${cy + SIGIL.R * Math.sin(pointAngle(k))}`).join(' '));
      octagon.setAttribute('fill', 'none');
      octagon.setAttribute('stroke-width', '2');
      octagon.setAttribute('stroke-dasharray', '5 4');
      octagon.style.stroke = 'var(--accent)';
      moved.append(octagon);
    }
    moved.append(copy);
    layer.append(moved);
    const text = sigil.words[word];
    letterLabel.innerHTML = letters.length
      ? [...text].map((ch, k) => letters.includes(k) ? `<mark>${ch}</mark>` : ch).join('')
      : `<span class="note">joins ${text} on</span>`;
  }
  letterLabel.style.display = 'block';
  letterLabel.style.left = `${event.clientX + 14}px`;
  letterLabel.style.top = `${event.clientY + 14}px`;
}
function hideLetters(){
  pointedAt = null;
  letterLabel.style.display = 'none';
  svg?.querySelector('.pointing')?.replaceChildren();
}
preview.addEventListener('pointermove', event => {
  const hit = event.target.closest?.('.hit');
  if (hit) showLetters(hit, event); else hideLetters();
});
preview.addEventListener('pointerleave', event => { if (event.pointerType == 'mouse') hideLetters(); });
preview.addEventListener('click', event => {   // (a tap, on a touch screen)
  const hit = event.target.closest?.('.hit');
  if (hit) showLetters(hit, event); else hideLetters();
});

// The preview: the picture, with the guides if asked for
function draw(){
  stopPlaying();
  hideLetters();
  const text = picture(byId('setSigilGuides').checked, true);
  preview.replaceChildren();
  svg = null;
  if (!text) {
    preview.innerHTML = '<span class="text-body-secondary small">Type a sentence to see its sigil.</span>';
  } else {
    preview.innerHTML = text;
    svg = preview.querySelector('svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'An AIDAScript sigil');
    svg.classList.toggle('transparent', settings().transparent);
    applyZoom();
  }
  updateButtons();
  png.prepare(text && svgText());
}

// Zoom: the preview only (the downloads are always the same size), remembered for the next visit
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ZOOM_KEY = 'aidascript.sigilZoom';
let zoom = 1;
try { const z = Number(localStorage.getItem(ZOOM_KEY)); if (ZOOMS.includes(z)) zoom = z; } catch { /* (not remembered) */ }
function applyZoom(){
  byId('sigilZoomReset').textContent = `${Math.round(zoom * 100)}%`;
  byId('sigilZoomOut').disabled = zoom == ZOOMS[0];
  byId('sigilZoomIn').disabled = zoom == ZOOMS.at(-1);
  if (!svg) return;
  svg.style.width = `${Number(svg.getAttribute('width')) * zoom}px`;
  svg.style.height = `${Number(svg.getAttribute('height')) * zoom}px`;
}
function changeZoom(to){
  zoom = to;
  try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* (not remembered) */ }
  applyZoom();
}
byId('sigilZoomIn').onclick = () => changeZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]);
byId('sigilZoomOut').onclick = () => changeZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]);
byId('sigilZoomReset').onclick = () => changeZoom(1);

function updateButtons(){
  for (const id of ['sigilSvg', 'sigilPng', 'sigilCopyImage', 'sigilGif', 'sigilPlay']) byId(id).disabled = !svg;
  // (the outline only matters with the marks, and on a background)
  byId('setSigilOutline').disabled = !byId('setSigilMarks').checked || byId('setSigilTransparent').checked;
}

// Random colors: a line and background color that go together (the same as the encoder's, see
// colors.js), and the name of the pairing
byId('sigilRandomColors').onclick = () => {
  const { line, background, name } = randomColors();
  byId('setSigilLine').value = line;
  byId('setSigilBg').value = background;
  byId('setSigilTransparent').checked = false;
  byId('sigilColorsName').textContent = name;
  remember();
  draw();
};


// -----------------------------------------------------------------------------
// Downloads (without the sentence: see above)
// -----------------------------------------------------------------------------

// The downloads are drawn again, without the guides (see picture)
function svgText(){
  return picture(false);
}

byId('sigilSvg').onclick = () => saveFile(new Blob([svgText()], { type: 'image/svg+xml' }), 'sigil.svg');

// The PNG, twice the size of the downloaded picture (the preview is bigger with the guides)
function pngBlob(){
  return new Promise((resolve, reject) => {
    const text = svgText();
    if (!text) { reject(new Error('nothing to draw')); return; }
    const size = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(Number(size.getAttribute('width')) * 2);
      c.height = Math.ceil(Number(size.getAttribute('height')) * 2);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(blob => blob ? resolve(blob) : reject(new Error('no PNG')), 'image/png');
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  });
}
// (made ahead after every drawing, so a click can save it at once: see ReadyPng in save.js)
const png = new ReadyPng(pngBlob);
byId('sigilPng').onclick = async () => saveFile(png.ready(svgText()) ?? await pngBlob(), 'sigil.png');

// A button's label for a moment (to say how something went), then back
function flash(button, text){
  clearTimeout(button.flashTimer);
  button.dataset.label ??= button.textContent;
  button.textContent = text;
  button.flashTimer = setTimeout(() => { button.textContent = button.dataset.label; }, 1600);
}

// "Copy image": the PNG on the clipboard, to paste anywhere (hidden where the browser can't do that).
// (The clipboard is handed a promise of the image, so the copy still counts as part of the click.)
byId('sigilCopyImage').hidden = !CAN_COPY;
byId('sigilCopyImage').onclick = () => {
  const ready = png.ready(svgText());
  copyPng(ready ? Promise.resolve(ready) : pngBlob(), text => flash(byId('sigilCopyImage'), text));
};


// -----------------------------------------------------------------------------
// Writing it out: "Play" in the preview, and "Download GIF" (see writing)
// -----------------------------------------------------------------------------

const WRITE_LINE = 150;   // how long one line takes to write, in milliseconds
const WRITE_HOLD = 1500;  // how long the whole sigil stays before it starts again (the GIF), ms
const WRITE_START = 400;  // how long the empty picture shows first, ms

let playing = null;   // the running animation's timer (null: not playing)
function stopPlaying(){
  if (!playing) return;
  clearTimeout(playing);
  playing = null;
  byId('sigilPlay').textContent = '▶ Play';
}
byId('sigilPlay').onclick = () => {
  if (playing) { stopPlaying(); draw(); return; }
  hideLetters();
  const total = writing(made.sigils.filter(s => s)).total, started = performance.now();
  byId('sigilPlay').textContent = '■ Stop';
  const frame = () => {
    const t = (performance.now() - started - WRITE_START) / WRITE_LINE;
    preview.innerHTML = picture(byId('setSigilGuides').checked, false, Math.max(0, t));
    svg = preview.querySelector('svg');
    svg.classList.toggle('transparent', settings().transparent);
    applyZoom();
    if (t < total + 1000 / WRITE_LINE) playing = setTimeout(frame, 33);   // (about 30 pictures a second)
    else { playing = null; byId('sigilPlay').textContent = '▶ Play'; draw(); }   // (a second at the end, then as before)
  };
  frame();
};

// The GIF: three frames per line, twice the size of the picture (like the PNG). Its colors are
// the background, the line color and the shades between them (the edges of the lines); with a
// transparent background, see-through and the line color.
const GIF_STEPS = 3, GIF_SHADES = 32;
async function gifBlob(){
  const sigils = made.sigils.filter(s => s);
  const total = writing(sigils).total;
  const { line, background, transparent } = settings();
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const ink = rgb(line), paper = rgb(background);
  const palette = transparent ? [[0, 0, 0], ink]
    : Array.from({ length: GIF_SHADES }, (_, i) => paper.map((c, j) => Math.round(c + (ink[j] - c) * i / (GIF_SHADES - 1))));
  const span = ink.map((c, j) => c - paper[j]), spanSq = span.reduce((a, b) => a + b * b, 0) || 1;

  const first = new DOMParser().parseFromString(picture(false), 'image/svg+xml').documentElement;
  const width = Math.ceil(Number(first.getAttribute('width')) * 2), height = Math.ceil(Number(first.getAttribute('height')) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const render = text => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { context.clearRect(0, 0, width, height); context.drawImage(img, 0, 0, width, height); resolve(); };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  });

  const frames = [], times = [0];
  for (let n = 1; n <= total * GIF_STEPS; n++) times.push(n / GIF_STEPS);
  for (const [n, t] of times.entries()) {
    await render(picture(false, false, t));
    const data = context.getImageData(0, 0, width, height).data, pixels = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < pixels.length; p++, i += 4) {
      if (transparent) { pixels[p] = data[i + 3] >= 128 ? 1 : 0; continue; }
      const d = (data[i] - paper[0]) * span[0] + (data[i + 1] - paper[1]) * span[1] + (data[i + 2] - paper[2]) * span[2];
      pixels[p] = Math.max(0, Math.min(GIF_SHADES - 1, Math.round(d / spanSq * (GIF_SHADES - 1))));
    }
    const delay = n == 0 ? WRITE_START : n == times.length - 1 ? WRITE_HOLD : WRITE_LINE / GIF_STEPS;
    frames.push({ pixels, delay: delay / 10 });
    if (n % 10 == 0) await new Promise(resolve => setTimeout(resolve));   // (let the page breathe)
  }
  return makeGif(frames, width, height, palette, transparent ? 0 : null);
}
byId('sigilGif').onclick = async () => {
  const button = byId('sigilGif');
  if (button.dataset.busy) return;
  button.dataset.busy = '1';
  const label = button.textContent;
  button.textContent = 'Making GIF…';
  try {
    saveFile(await gifBlob(), 'sigil.gif');
  } catch {
    flash(button, "Couldn't make it");
  } finally {
    delete button.dataset.busy;
    if (button.textContent == 'Making GIF…') button.textContent = label;
  }
};


// -----------------------------------------------------------------------------
// Settings: remembered for the next visit
// -----------------------------------------------------------------------------

function remember(){
  try {
    const values = Object.fromEntries(SETTINGS.map(id => [id, byId(id).type == 'checkbox' ? byId(id).checked : byId(id).value]));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(values));
  } catch { /* (storage not allowed: nothing to remember) */ }
}
function restore(){
  try {
    const values = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    for (const id of SETTINGS) {
      if (!(id in values)) continue;
      if (byId(id).type == 'checkbox') byId(id).checked = values[id] === true;
      else if (typeof values[id] == 'string') byId(id).value = values[id];
    }
  } catch { /* (nothing remembered, or storage not allowed) */ }
}

for (const id of SETTINGS) {
  byId(id).addEventListener(byId(id).type == 'range' ? 'change' : 'input', () => { remember(); workOut(); });
}

// The settings fold away (handy on a phone): folded to begin with on a small screen, and
// remembered open or folded after that
const FOLDED_KEY = 'aidascript.sigilSettingsFolded';
const settingsBox = byId('sigilSettingsBox');
try {
  const folded = localStorage.getItem(FOLDED_KEY);
  settingsBox.open = folded === null ? window.innerWidth >= 768 : folded != 'true';
} catch {
  settingsBox.open = window.innerWidth >= 768;
}
settingsBox.addEventListener('toggle', () => {
  try { localStorage.setItem(FOLDED_KEY, String(!settingsBox.open)); } catch { /* (not remembered) */ }
});

restore();
countLayouts();
workOut();
