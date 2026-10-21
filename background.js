// Uptray — service worker.
// Lista os downloads recentes e intermedeia a leitura dos arquivos
// (feita no documento offscreen, que consegue ler file:// via XHR).

const DEFAULTS = { enabled: true, disabledSites: [], maxItems: 8, readClipboard: true };
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;
const THUMB_MAX_BYTES = 25 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({ ...DEFAULTS, ...cur });
});

// ---------- offscreen ----------
let creating = null;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url],
  });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "Ler arquivos baixados para anexá-los em formulários.",
      })
      .catch((err) => {
        if (!String(err).includes("Only a single offscreen")) throw err;
      })
      .finally(() => (creating = null));
  }
  await creating;
}

async function toOffscreen(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ ...msg, target: "offscreen" });
}

// ---------- utilidades ----------
function pathToFileUrl(p) {
  const norm = p.replace(/\\/g, "/");
  const parts = norm.split("/").map((seg, i) =>
    i === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)
  );
  const joined = parts.join("/");
  if (norm.startsWith("//")) return "file:" + joined; // caminho de rede \\servidor\pasta
  return joined.startsWith("/") ? "file://" + joined : "file:///" + joined;
}

function baseName(p) {
  return p.split(/[\\/]/).pop();
}

const imageThumbs = new Map(); // "id:endTime" -> { kind: "image", src }
const iconCache = new Map(); // id -> { kind: "icon", src }

const isImageItem = (item) =>
  (item.mime || "").startsWith("image/") || IMAGE_EXT.test(item.filename);

function remember(map, key, val) {
  map.set(key, val);
  if (map.size > 200) map.delete(map.keys().next().value);
}

// Rápido: miniatura de imagem já em cache, senão o ícone do sistema
async function quickThumb(item) {
  const img = imageThumbs.get(`${item.id}:${item.endTime}`);
  if (img) return img;
  if (iconCache.has(item.id)) return iconCache.get(item.id);
  let icon = null;
  try {
    const src = await chrome.downloads.getFileIcon(item.id, { size: 32 });
    if (src) icon = { kind: "icon", src };
  } catch (_) {}
  remember(iconCache, item.id, icon);
  return icon;
}

// Lento: lê a imagem e gera a miniatura (pedido separado pelo popup)
async function imageThumb(id) {
  const [item] = await chrome.downloads.search({ id });
  if (!item || !item.exists || !isImageItem(item)) return { ok: false };
  const key = `${item.id}:${item.endTime}`;
  if (imageThumbs.has(key)) return { ok: true, thumb: imageThumbs.get(key) };
  if (!(item.fileSize > 0 && item.fileSize < THUMB_MAX_BYTES)) return { ok: false };
  const res = await toOffscreen({ type: "thumb", url: pathToFileUrl(item.filename) });
  if (!res || !res.ok) return { ok: false };
  const thumb = { kind: "image", src: res.dataUrl };
  remember(imageThumbs, key, thumb);
  return { ok: true, thumb };
}

async function listRecent(max) {
  const fileAccess = await chrome.extension.isAllowedFileSchemeAccess();
  const items = await chrome.downloads.search({
    state: "complete",
    exists: true,
    orderBy: ["-endTime"],
    limit: Math.max(max * 3, 20),
  });

  // remove duplicados (mesmo arquivo baixado mais de uma vez) e itens sem caminho
  const seen = new Set();
  const picked = [];
  for (const it of items) {
    if (!it.filename || seen.has(it.filename)) continue;
    seen.add(it.filename);
    picked.push(it);
    if (picked.length >= max) break;
  }

  const result = await Promise.all(
    picked.map(async (it) => ({
      id: it.id,
      name: baseName(it.filename),
      mime: it.mime || "",
      size: it.fileSize || it.totalBytes || 0,
      endTime: it.endTime,
      isImage: isImageItem(it),
      thumb: await quickThumb(it),
    }))
  );
  return { fileAccess, items: result };
}

async function openFile(id) {
  const [it] = await chrome.downloads.search({ id });
  if (!it || !it.exists) return { ok: false, error: "Arquivo não encontrado (foi movido ou apagado?)" };
  const res = await toOffscreen({ type: "open", url: pathToFileUrl(it.filename) });
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || "Falha ao ler o arquivo" };
  return { ok: true, token: res.token, chunks: res.chunks, size: res.size, name: baseName(it.filename), mime: it.mime || "" };
}

// ---------- mensagens ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === "offscreen") return false;

  const handlers = {
    list: () => listRecent(Math.min(Math.max(msg.max || 8, 1), 16)),
    open: () => openFile(msg.id),
    thumb: () => imageThumb(msg.id),
    chunk: () => toOffscreen({ type: "chunk", token: msg.token, index: msg.index }),
    release: () => toOffscreen({ type: "release", token: msg.token }),
    openSettings: async () => {
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
      return { ok: true };
    },
    fileAccess: async () => ({ fileAccess: await chrome.extension.isAllowedFileSchemeAccess() }),
  };

  const fn = handlers[msg.type];
  if (!fn) return false;
  fn()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // resposta assíncrona
});

chrome.downloads.onErased.addListener(() => {
  imageThumbs.clear();
  iconCache.clear();
});
