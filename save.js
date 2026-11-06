// =============================================================================
// AIDAScript: saving a picture (used by the encoder and the Sigils page)
//
// - Inside another app's built-in browser (a link opened from Discord, Messenger, Instagram...),
//   downloads and copying are quietly ignored, so the picture is shown instead, to press and hold
//   (where the app allows that), with a button to open the page in the phone's own browser.
// - On an iPhone or iPad, the share sheet, where "Save Image" puts it in Photos.
// - Everywhere else (or if sharing doesn't work), a download.
// =============================================================================

const UA = navigator.userAgent;
const IS_IOS = /iPad|iPhone|iPod/.test(UA) ||
               (navigator.platform == 'MacIntel' && navigator.maxTouchPoints > 1);   // (an iPad asking for the desktop site)
const IS_ANDROID = /Android/.test(UA);
// (an Android app's built-in browser says "wv"; these apps say who they are, on any phone)
const IN_APP = (IS_ANDROID && /; wv\)/.test(UA)) ||
               /FBAN|FBAV|FB_IAB|Instagram|Messenger|Discord|Snapchat|TikTok|musical_ly|BytedanceWebview|Line\/|MicroMessenger|Twitter|Threads|Pinterest|LinkedInApp|GSA\//.test(UA);

async function saveFile(blob, name){
  if (IN_APP) { showPicture(blob); return; }
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

// "Copy image": the PNG (a promise of it) on the clipboard; `say` shows how it went. Inside an
// app's browser, or if the clipboard doesn't answer within a few seconds, the picture is shown instead.
async function copyPng(pngPromise, say){
  if (IN_APP) { showPicture(await pngPromise); return; }
  try {
    const copying = navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
    const late = new Promise((_, reject) => setTimeout(() => reject(new Error('no answer')), 4000));
    await Promise.race([copying, late]);
    say('Copied!');
  } catch {
    say("Couldn't copy");
    showPicture(await pngPromise);
  }
}
const CAN_COPY = IN_APP || !!(window.ClipboardItem && navigator.clipboard?.write);

// The picture in a box over the page, to press and hold, with a way out to the phone's browser
function showPicture(blob){
  let box = document.getElementById('savePicture');
  if (!box) {
    box = document.createElement('dialog');
    box.id = 'savePicture';
    box.className = 'save-picture';
    box.innerHTML = `
      <p class="mb-2"><strong class="how-to-save"></strong></p>
      <p class="small text-body-secondary mb-2">This app's built-in browser can't download or copy.
        If holding doesn't offer to save, open the page in your browser.</p>
      <img alt="The picture, to save">
      <div class="d-flex flex-wrap gap-2 justify-content-end mt-3">
        <a class="btn btn-sm btn-outline-primary open-browser" target="_blank" rel="noopener">Open in browser</a>
        <button type="button" class="btn btn-sm btn-primary close-picture">Close</button>
      </div>`;
    box.querySelector('.close-picture').onclick = () => box.close();
    box.addEventListener('click', event => { if (event.target == box) box.close(); });   // (a tap outside it)
    document.body.append(box);
  }
  // (on Android, an "intent" link hands the page to the phone's own browser; elsewhere, a plain link)
  box.querySelector('.open-browser').href = IS_ANDROID
    ? `intent://${location.host}${location.pathname}#Intent;scheme=${location.protocol.slice(0, -1)};end`
    : location.href.split('#')[0];
  box.querySelector('.how-to-save').textContent = matchMedia('(pointer: coarse)').matches
    ? 'Press and hold the picture to save it.' : 'Right-click the picture to copy or save it.';
  box.querySelector('.open-browser').hidden = !IN_APP;
  box.querySelector('.text-body-secondary').hidden = !IN_APP;
  // (as a data: address, which a press-and-hold "save image" can keep, unlike a blob: one)
  const reader = new FileReader();
  reader.onload = () => {
    box.querySelector('img').src = reader.result;
    if (!box.open) box.showModal ? box.showModal() : box.setAttribute('open', '');
  };
  reader.readAsDataURL(blob);
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
