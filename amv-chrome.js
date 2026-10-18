/* AMV FOR CHROME - THE WHOLE OF IT.

   It does one thing: it opens AMV with something from the page you are on - a
   selection, the page itself, or a link - in a new chat's box, and stops
   there. AMV never sends it on its own; you say what you want done with it.

   WHAT IT CANNOT DO, BY ITS PERMISSIONS. It holds no key and no sign-in, so
   there is nothing in it worth stealing. It can read a page only when you
   press it there (activeTab), never in the background, and it has no host
   permission for any site. The one place its script runs is AMV itself, to
   hand over what you chose.

   NOT IN THE ADDRESS BAR. What you share is kept in the browser's session
   storage - memory only, gone when Chrome closes - and handed to the AMV tab
   it opened, for that tab only. Put in the address, it would sit in your
   browsing history. */
const AMV = '__AMV_ORIGIN__';
const TEXT_MAX = 8000, OTHER_MAX = 2000, STALE_MS = 60000;

function clip(v, n){ return String(v == null ? '' : v).slice(0, n); }

async function hand(share){
  const tab = await chrome.tabs.create({ url: AMV + '/?amvext=1' });
  await chrome.storage.session.set({ ['share:' + tab.id]: {
    title: clip(share.title, OTHER_MAX), url: clip(share.url, OTHER_MAX), text: clip(share.text, TEXT_MAX), at: Date.now() } });
}

/* The page you pressed it on: what you selected, or else its text. A page
   Chrome will not let an extension read (its own settings, the web store)
   still gives its title and address. */
async function askAboutPage(tab){
  if(!tab || tab.id == null) return;
  let got = null;
  try{
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id },
      func: () => ({ sel: String(getSelection() || ''), text: String((document.body && document.body.innerText) || '') }) });
    got = r && r.result;
  }catch(e){ got = null; }
  await hand({ title: tab.title, url: tab.url, text: got ? (got.sel.trim() || got.text) : '' });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'amv-selection', title: 'Ask AMV about “%s”', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'amv-link', title: 'Ask AMV about this link', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'amv-page', title: 'Ask AMV about this page', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if(info.menuItemId === 'amv-selection') return hand({ title: tab && tab.title, url: tab && tab.url, text: info.selectionText });
  if(info.menuItemId === 'amv-link') return hand({ url: info.linkUrl, text: info.selectionText || '' });
  return askAboutPage(tab);
});
chrome.action.onClicked.addListener(askAboutPage);

/* The AMV tab asking for what it was opened with. Only a tab on AMV's own
   address, only its own share, and only once. */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.amv !== 'share?' || !sender.tab || sender.origin !== AMV){ reply(null); return; }
  const key = 'share:' + sender.tab.id;
  chrome.storage.session.get(key).then(async (o) => {
    const s = o && o[key];
    await chrome.storage.session.remove(key);
    reply(s && Date.now() - s.at < STALE_MS ? { title: s.title, url: s.url, text: s.text } : null);
  }, () => reply(null));
  return true;
});
