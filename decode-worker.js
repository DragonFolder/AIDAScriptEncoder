// =============================================================================
// AIDAScript decoder worker: reads a picture in the background, so the page stays responsive
// while it works (see "11. Reading a picture" in index.js). It uses the same code as the page
// (layout.js and decode.js).
//
// Request:  { id, rgba (an ArrayBuffer of RGBA pixels), width, height }
// Replies:  { id, way } as each way of reading starts (see decodeAnyHow), then
//           { id, result } (see decodePicture), or { id, error } if reading failed
// =============================================================================

importScripts('layout.js', 'decode.js');

onmessage = ({ data: { id, rgba, width, height } }) => {
  try {
    const ink = inkMask(new Uint8ClampedArray(rgba), width, height);
    postMessage({ id, result: decodeAnyHow(ink, width, height, way => postMessage({ id, way })) });
  } catch (error) {
    postMessage({ id, error: String(error?.message ?? error) });
  }
};
