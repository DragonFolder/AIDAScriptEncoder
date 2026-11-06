// =============================================================================
// AIDAScript layout worker: lays out the compact shape in the background, so the
// page stays responsive while it works (see "Compact layouts in the background"
// in index.js). It uses the same layout code as the page (layout.js).
//
// Requests (from index.js):
//   { type: 'layouts', key, textLines, config }  ->  { type: 'layouts', key, layouts }
//   { type: 'more', key }                        ->  { type: 'more', key, layout }
// `config` holds the settings the layout depends on; `key` comes back unchanged, so the page
// can tell which request a reply is for. 'more' looks for one more layout for the last
// 'layouts' request (`layout` is null when there's none left).
// =============================================================================

importScripts('layout.js' + location.search);   // (with the page's ?v=)

let found = null;   // the last 'layouts' request's result: { layouts, more }

onmessage = ({ data }) => {
  if (data.type == 'layouts') {
    Object.assign(CONFIG, data.config);
    found = compactLayouts(data.textLines);
    postMessage({ type: 'layouts', key: data.key, layouts: found.layouts });
  } else if (data.type == 'more') {
    const layout = found && found.more() ? found.layouts[found.layouts.length - 1] : null;
    postMessage({ type: 'more', key: data.key, layout });
  }
};
