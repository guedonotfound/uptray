const DEFAULTS = { enabled: true, disabledSites: [], maxItems: 8, readClipboard: true };
const $ = (id) => document.getElementById(id);

(async () => {
  const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };

  // site da aba atual (activeTab não é necessário: só lemos a URL quando o popup abre)
  let host = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const u = new URL(tab && tab.url ? tab.url : "");
    if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, "");
  } catch (_) {}

  $("enabled").checked = s.enabled;
  $("readClipboard").checked = s.readClipboard;
  $("maxItems").value = String(s.maxItems);

  if (host) {
    $("siteName").textContent = host;
    $("site").checked = !s.disabledSites.includes(host);
  } else {
    $("siteRow").hidden = true;
  }

  const save = (patch) => chrome.storage.sync.set(patch);

  $("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
  $("readClipboard").addEventListener("change", (e) => save({ readClipboard: e.target.checked }));
  $("maxItems").addEventListener("change", (e) => save({ maxItems: Number(e.target.value) }));
  $("site").addEventListener("change", async (e) => {
    const cur = (await chrome.storage.sync.get({ disabledSites: [] })).disabledSites;
    const set = new Set(cur);
    if (e.target.checked) set.delete(host);
    else set.add(host);
    save({ disabledSites: [...set] });
  });

  if (!(await chrome.extension.isAllowedFileSchemeAccess())) $("warn").hidden = false;
  $("openSettings").addEventListener("click", () =>
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
  );
})();
