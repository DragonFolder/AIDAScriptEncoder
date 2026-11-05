// =============================================================================
// AIDAScript sigil worker: draws sigils in the background, so the page stays responsive while a
// long sentence is worked out (see sigils.js). It uses the same code as the page (sigil.js).
//
// Request:  { id, lines (the text's lines), layout (0: the first) }
// Reply:    { id, sigils, more }
//   sigils: one per line (see sigilOf; null for a line with no letters), each in that layout, or in
//     its last one if it has fewer;
//   more: whether any line had that layout (false: there are no more, see SigilLayouts)
// Or, to count the layouts (slow: the page uses a worker of its own for it):
// Request:  { id, lines, count: true }     Reply: { id, total } (see layoutCount)
// =============================================================================

importScripts('layout.js', 'sigil.js');

const layouts = new Map();   // each line's layouts, kept (see SigilLayouts)

onmessage = ({ data: { id, lines, layout, count } }) => {
  if (count) postMessage({ id, total: layoutCount(lines, layouts) });
  else postMessage({ id, ...sigilsInLayout(lines, layout, layouts) });
};
