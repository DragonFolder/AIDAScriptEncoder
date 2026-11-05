// =============================================================================
// AIDAScript sigil worker: draws sigils in the background, so the page stays responsive while a
// long sentence is worked out (see sigils.js). It uses the same code as the page (sigil.js).
//
// Request:  { id, lines (the text's lines), layout (0: the first) }
// Reply:    { id, sigils, more }
//   sigils: one per line (see sigilOf; null for a line with no letters), each in that layout, or in
//     its last one if it has fewer;
//   more: whether any line had that layout (false: there are no more, see SigilLayouts)
// =============================================================================

importScripts('layout.js', 'sigil.js');

const layouts = new Map();   // each line's layouts, kept (see SigilLayouts)

onmessage = ({ data: { id, lines, layout } }) => {
  postMessage({ id, ...sigilsInLayout(lines, layout, layouts) });
};
