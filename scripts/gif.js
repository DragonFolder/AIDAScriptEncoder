// =============================================================================
// AIDAScript: a small animated GIF maker (used by the Sigils page's "Download GIF")
//
// makeGif(frames, width, height, palette, transparent) -> a Blob (image/gif)
//   frames:  [{ pixels, delay }]: each frame's pixels as palette indexes (a Uint8Array, row by row,
//            width x height), and how long it's shown, in hundredths of a second
//   palette: [[r, g, b], ...], at most 256 colors
//   transparent: the palette index that's see-through (or null)
// The animation loops forever. Each frame only stores the rectangle that changed since the one
// before (the rest stays as it was), and a frame that changes nothing just makes the one before
// it last longer, which keeps the file small.
// =============================================================================

function makeGif(frames, width, height, palette, transparent = null){
  const bytes = [];
  const byte = b => bytes.push(b & 255);
  const word = w => { byte(w); byte(w >> 8); };
  const text = s => { for (const ch of s) byte(ch.charCodeAt(0)); };

  // (the color table's size is a power of two, at least 4)
  let bits = 2;
  while ((1 << bits) < palette.length) bits++;

  // The frames, as the rectangles that changed
  const parts = [];
  let before = null;
  for (const { pixels, delay } of frames) {
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    if (!before) { x0 = 0; y0 = 0; x1 = width - 1; y1 = height - 1; }
    else {
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          if (pixels[row + x] != before[row + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
          }
        }
      }
    }
    if (x1 < 0) { parts.at(-1).delay += delay; continue; }   // (nothing changed)
    const w = x1 - x0 + 1, h = y1 - y0 + 1, part = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) part.set(pixels.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + w), y * w);
    parts.push({ x: x0, y: y0, w, h, pixels: part, delay });
    before = pixels;
  }

  // Header, screen and color table
  text('GIF89a');
  word(width); word(height);
  byte(0x80 | ((bits - 1) << 4) | (bits - 1));   // (a global color table of 2^bits colors)
  byte(0); byte(0);
  for (let i = 0; i < (1 << bits); i++) for (const c of palette[i] ?? [0, 0, 0]) byte(c);
  // Loop forever
  byte(0x21); byte(0xff); byte(11); text('NETSCAPE2.0'); byte(3); byte(1); word(0); byte(0);

  for (const part of parts) {
    // How long it's shown, and that it's drawn over the frame before (disposal 1)
    byte(0x21); byte(0xf9); byte(4);
    byte((1 << 2) | (transparent != null ? 1 : 0));
    word(Math.max(2, Math.round(part.delay)));
    byte(transparent ?? 0); byte(0);
    // Where it goes
    byte(0x2c); word(part.x); word(part.y); word(part.w); word(part.h); byte(0);
    // Its pixels, compressed
    byte(bits);
    const data = lzw(part.pixels, bits);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      byte(n);
      for (let k = 0; k < n; k++) bytes.push(data[i + k]);
    }
    byte(0);
  }
  byte(0x3b);
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

// GIF's LZW compression: palette indexes -> bytes (codes packed from the lowest bit up)
function lzw(indexes, minCodeSize){
  const clear = 1 << minCodeSize, end = clear + 1;
  const out = [];
  let buffer = 0, filled = 0;
  let size = minCodeSize + 1, next = end + 1;
  const codes = new Map();
  const emit = code => {
    buffer |= code << filled;
    filled += size;
    while (filled >= 8) { out.push(buffer & 255); buffer >>>= 8; filled -= 8; }
  };
  emit(clear);
  let prefix = indexes[0];
  for (let i = 1; i < indexes.length; i++) {
    const k = indexes[i], key = prefix * 256 + k;
    const known = codes.get(key);
    if (known !== undefined) { prefix = known; continue; }
    emit(prefix);
    if (next == 4096) {   // (the table is full: start over)
      emit(clear);
      codes.clear();
      size = minCodeSize + 1;
      next = end + 1;
    } else {
      if (next >= (1 << size)) size++;
      codes.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (filled > 0) out.push(buffer & 255);
  return out;
}
