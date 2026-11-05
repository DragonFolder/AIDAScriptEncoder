// =============================================================================
// AIDAScript sigil worker: draws sigils in the background, so the page stays responsive while a
// long sentence is worked out (see sigils.js). It uses the same code as the page (sigil.js).
//
// Request:  { id, lines (the text's lines), spread }
// Reply:    { id, sigils } (one per line: see sigilOf, null for a line with no letters)
// =============================================================================

importScripts('layout.js', 'sigil.js');

onmessage = ({ data: { id, lines, spread } }) => {
  postMessage({ id, sigils: lines.map(line => sigilOf(line, { spread })) });
};
