// =============================================================================
// AIDAScript: saving a picture (used by the encoder and the Sigils page)
//
// On an iPhone or iPad, the share sheet, where "Save Image" puts it in Photos (a download there
// lands in Files, if Safari lets it through at all). Everywhere else, or if sharing doesn't work,
// a download.
// =============================================================================

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.platform == 'MacIntel' && navigator.maxTouchPoints > 1);   // (an iPad asking for the desktop site)

async function saveFile(blob, name){
  if (IS_IOS) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (error) {
        if (error.name == 'AbortError') return;   // (the share sheet was closed: nothing more to do)
      }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);   // (some phone browsers only follow a link that's on the page)
  a.click();
  a.remove();
  // (kept for a minute: a phone may ask "Download?" first, and only fetches it after the answer)
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// A PNG made ahead of time, so a click can save it straight away (Safari only lets a click share
// or download for a moment; making the PNG first could take longer than that). `make` makes it,
// `key` says what it's of: it's made again only when that changes.
class ReadyPng {
  constructor(make){
    this.make = make;
    this.key = null;
    this.blob = null;
    this.timer = null;
  }
  // (after every change: a little later, so it isn't made over and over while typing)
  prepare(key){
    clearTimeout(this.timer);
    if (key == this.key) return;
    this.key = key;
    this.blob = null;
    if (key == null) return;
    this.timer = setTimeout(() => {
      this.make().then(blob => { if (this.key == key) this.blob = blob; }, () => {});
    }, 300);
  }
  // The PNG for `key` if it's ready (null if not: then it has to be made now)
  ready(key){
    return key == this.key ? this.blob : null;
  }
}
