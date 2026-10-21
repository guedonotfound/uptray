const CHUNK = 4 * 1024 * 1024; // 4 MB por mensagem
const MAX_SIZE = 500 * 1024 * 1024;
const store = new Map(); // token -> { buf, timer }

function readFile(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = () =>
      xhr.response
        ? resolve(xhr.response)
        : reject(new Error("Arquivo vazio ou ilegível"));
    xhr.onerror = () =>
      reject(
        new Error(
          'Sem acesso ao arquivo. Ative "Permitir acesso a URLs de arquivo" na extensão.',
        ),
      );
    xhr.send();
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function makeThumb(url) {
  const buf = await readFile(url);
  const bmp = await createImageBitmap(new Blob([buf]));
  const S = 160;
  const scale = Math.min(1, S / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  return blobToDataUrl(blob);
}

function release(token) {
  const entry = store.get(token);
  if (entry) clearTimeout(entry.timer);
  store.delete(token);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return false;

  (async () => {
    switch (msg.type) {
      case "thumb":
        return { ok: true, dataUrl: await makeThumb(msg.url) };

      case "open": {
        const buf = await readFile(msg.url);
        if (buf.byteLength > MAX_SIZE)
          throw new Error(
            'Arquivo grande demais para o atalho; use "Procurar no computador".',
          );
        const token = crypto.randomUUID();
        // descarta sozinho se o content script sumir no meio do caminho
        store.set(token, {
          buf,
          timer: setTimeout(() => release(token), 120000),
        });
        return {
          ok: true,
          token,
          size: buf.byteLength,
          chunks: Math.max(1, Math.ceil(buf.byteLength / CHUNK)),
        };
      }

      case "chunk": {
        const entry = store.get(msg.token);
        if (!entry) throw new Error("Leitura expirada, tente de novo.");
        const start = msg.index * CHUNK;
        const slice = entry.buf.slice(start, start + CHUNK);
        const dataUrl = await blobToDataUrl(new Blob([slice]));
        return { ok: true, b64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
      }

      case "release":
        release(msg.token);
        return { ok: true };

      default:
        throw new Error("Mensagem desconhecida: " + msg.type);
    }
  })()
    .then(sendResponse)
    .catch((err) =>
      sendResponse({ ok: false, error: String((err && err.message) || err) }),
    );

  return true;
});
