(() => {
  if (window.__uptrayContent) return;
  window.__uptrayContent = true;

  const EVT_OPEN = "uptray:open";
  const EVT_NATIVE = "uptray:native";
  const EVT_FILES = "uptray:files";
  const EVT_CANCEL = "uptray:cancel";
  const DEFAULTS = {
    enabled: true,
    disabledSites: [],
    maxItems: 8,
    readClipboard: true,
    alwaysShow: true,
  };

  let settings = { ...DEFAULTS };
  let alive = true;

  try {
    chrome.storage.sync.get(
      DEFAULTS,
      (s) => (settings = { ...DEFAULTS, ...s }),
    );
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
    });
  } catch (_) {
    alive = false;
  }

  function extensionAlive() {
    try {
      return alive && !!chrome.runtime && !!chrome.runtime.id;
    } catch (_) {
      return false;
    }
  }

  function siteDisabled(host) {
    return (settings.disabledSites || []).some(
      (s) => host === s || host.endsWith("." + s),
    );
  }

  function send(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // ---------- formatação ----------
  const rtf = new Intl.RelativeTimeFormat("pt-BR", {
    numeric: "auto",
    style: "short",
  });
  function ago(iso) {
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 45) return "agora";
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
    return new Date(iso).toLocaleDateString("pt-BR");
  }
  function fmtSize(n) {
    if (!n) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) ((n /= 1024), i++);
    return `${n < 10 && i ? n.toFixed(1).replace(".", ",") : Math.round(n)} ${u[i]}`;
  }
  function extOf(name) {
    const m = /\.([^.]+)$/.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }

  const MIME_BY_EXT = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    zip: "application/zip",
    doc: "application/msword",
    xls: "application/vnd.ms-excel",
    ppt: "application/vnd.ms-powerpoint",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    xml: "application/xml",
  };
  const guessMime = (name, mime) =>
    mime || MIME_BY_EXT[extOf(name)] || "application/octet-stream";

  // Verifica se o arquivo combina com o atributo accept do input
  function accepts(accept, name, mime) {
    if (!accept || !accept.trim()) return true;
    const ext = "." + extOf(name);
    mime = guessMime(name, mime).toLowerCase();
    return accept
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .some((tok) => {
        if (tok.startsWith(".")) return ext === tok;
        if (tok.endsWith("/*")) return mime.startsWith(tok.slice(0, -1));
        return mime === tok;
      });
  }

  // ---------- leitura de arquivos ----------
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function loadDownload(item, onProgress) {
    const meta = await send({ type: "open", id: item.id });
    if (!meta || !meta.ok)
      throw new Error((meta && meta.error) || "Falha ao ler o arquivo");
    const parts = [];
    try {
      for (let i = 0; i < meta.chunks; i++) {
        const c = await send({ type: "chunk", token: meta.token, index: i });
        if (!c || !c.ok)
          throw new Error((c && c.error) || "Falha ao ler o arquivo");
        parts.push(b64ToBytes(c.b64));
        onProgress && onProgress((i + 1) / meta.chunks);
      }
    } finally {
      send({ type: "release", token: meta.token }).catch(() => {});
    }
    return new File(parts, meta.name, {
      type: guessMime(meta.name, meta.mime),
      lastModified: Date.now(),
    });
  }

  async function readClipboardImage() {
    if (
      !settings.readClipboard ||
      !navigator.clipboard ||
      !navigator.clipboard.read
    )
      return null;
    try {
      const perm = await navigator.permissions
        .query({ name: "clipboard-read" })
        .catch(() => null);
      if (perm && perm.state === "denied") return null;
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await it.getType(type);
        const ext = type
          .split("/")[1]
          .replace("jpeg", "jpg")
          .replace("svg+xml", "svg");
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const name = `colado-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
        return new File([blob], name, { type, lastModified: Date.now() });
      }
    } catch (_) {}
    return null;
  }

  // ---------- estilos ----------
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .backdrop {
    --bg: #ffffff; --fg: #1d1d1f; --muted: #6b6b73; --line: #e6e6ea; --tile: #f5f5f7;
    --tile-hover: #ececf0; --accent: #3b5bdb; --accent-fg: #fff; --ring: rgba(59,91,219,.35);
    --shadow: 0 24px 64px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.08);
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center; padding: 16px;
    background: rgba(15,15,20,.28);
    font: 13px/1.4 "Segoe UI", system-ui, -apple-system, sans-serif; color: var(--fg);
    animation: fade .12s ease-out;
  }
  @media (prefers-color-scheme: dark) {
    .backdrop {
      --bg: #232327; --fg: #f2f2f4; --muted: #9a9aa3; --line: #34343a; --tile: #2c2c31;
      --tile-hover: #36363c; --accent: #7c95ff; --accent-fg: #0d1030; --ring: rgba(124,149,255,.4);
      --shadow: 0 24px 64px rgba(0,0,0,.55); background: rgba(0,0,0,.45);
    }
  }
  @keyframes fade { from { opacity: 0 } }
  @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.98) } }
  .card {
    width: min(560px, 100%); max-height: min(560px, calc(100vh - 32px));
    display: flex; flex-direction: column;
    background: var(--bg); border-radius: 14px; box-shadow: var(--shadow);
    border: 1px solid var(--line); overflow: hidden; animation: pop .14s ease-out;
  }
  header { display: flex; align-items: center; gap: 8px; padding: 14px 16px 8px; }
  header h1 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
  .x { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--muted); }
  .x:hover { background: var(--tile); color: var(--fg); }
  .body { overflow: auto; padding: 0 16px 8px; }
  h2 { margin: 12px 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
  .tile {
    all: unset; position: relative; cursor: pointer; display: flex; flex-direction: column; gap: 6px;
    padding: 8px; border-radius: 10px; background: var(--tile); min-width: 0;
    outline: 2px solid transparent; outline-offset: -2px; transition: background .1s;
  }
  .tile:hover { background: var(--tile-hover); }
  .tile:focus-visible { outline-color: var(--accent); }
  .tile.sel { outline-color: var(--accent); background: var(--tile-hover); }
  .tile[aria-disabled="true"] { opacity: .4; cursor: not-allowed; }
  .tile.busy { cursor: progress; }
  .thumb {
    height: 78px; border-radius: 7px; background: var(--bg); display: grid; place-items: center;
    overflow: hidden; position: relative;
  }
  .thumb img.full { width: 100%; height: 100%; object-fit: cover; }
  .thumb img.icon { width: 32px; height: 32px; }
  .thumb .glyph { color: var(--muted); }
  .thumb .ext { position: absolute; bottom: 5px; right: 6px; font-size: 10px; font-weight: 700; color: var(--muted); text-transform: uppercase; }
  .name { font-weight: 500; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; min-height: 2.8em; }
  .meta { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .check {
    position: absolute; top: 12px; left: 12px; width: 18px; height: 18px; border-radius: 50%;
    background: var(--accent); color: var(--accent-fg); display: none; place-items: center; font-size: 12px; font-weight: 700;
  }
  .tile.sel .check { display: grid; }
  .bar { position: absolute; left: 8px; right: 8px; bottom: 4px; height: 3px; border-radius: 2px; background: var(--line); overflow: hidden; display: none; }
  .tile.busy .bar { display: block; }
  .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .15s; }
  .hint { padding: 10px 12px; border-radius: 10px; background: var(--tile); color: var(--muted); }
  .hint kbd, footer kbd { font: 600 11px/1 inherit; padding: 2px 5px; border-radius: 4px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
  .notice { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .notice button { all: unset; cursor: pointer; color: var(--accent); font-weight: 600; text-decoration: underline; }
  .err { margin-top: 10px; padding: 8px 12px; border-radius: 8px; background: rgba(220,53,69,.12); color: #d6336c; display: none; }
  .err.show { display: block; }
  footer { display: flex; align-items: center; gap: 8px; padding: 12px 16px 14px; border-top: 1px solid var(--line); margin-top: 8px; }
  footer .tip { flex: 1; color: var(--muted); font-size: 12px; }
  .btn { all: unset; cursor: pointer; padding: 8px 14px; border-radius: 9px; font-weight: 600; background: var(--tile); }
  .btn:hover { background: var(--tile-hover); }
  .btn:focus-visible { box-shadow: 0 0 0 3px var(--ring); }
  .btn.primary { background: var(--accent); color: var(--accent-fg); }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn[hidden] { display: none; }
  @media (max-width: 420px) { footer .tip { display: none; } }
  `;

  // ---------- UI ----------
  let current = null; // sessão aberta

  // ---------- "firewall" de eventos ----------
  // Muitos sites fecham modais ao detectar clique, foco ou tecla "fora" deles (ex.: Pipefy).
  // Como o popup fica fora do modal do site, interceptamos esses eventos na fase de captura
  // da window (registrada antes dos scripts da página) e o site nunca os vê. Como isso também
  // impede que cheguem aos nossos elementos, os handlers do popup são chamados por aqui.
  const handlers = new WeakMap(); // elemento -> { tipo: fn }

  function on(el, type, fn) {
    const map = handlers.get(el) || {};
    map[type] = fn;
    handlers.set(el, map);
  }

  const FW_TYPES = [
    "pointerdown",
    "pointerup",
    "pointercancel",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
    "touchstart",
    "touchend",
    "touchmove",
    "wheel",
    "focusin",
    "focusout",
    "keydown",
    "keyup",
    "keypress",
    "paste",
  ];
  const PASSIVE = new Set(["touchstart", "touchend", "touchmove", "wheel"]);

  function firewall(e) {
    const s = current;
    if (!s || !s.host) return;
    const path = e.composedPath();
    const inside = path.includes(s.host) || e.relatedTarget === s.host;
    const modalOnly = e.type.startsWith("key") || e.type === "paste"; // popup é modal: teclado é nosso
    if (!inside && !modalOnly) return;

    e.stopImmediatePropagation();
    if (e.type === "keydown") return s.onKey(e);
    if (e.type === "paste") return s.onPaste(e);
    // reproduz o "bubbling" só dentro do nosso popup
    const inner = innerPath(s, e);
    for (const node of inner) {
      const fn = handlers.get(node)?.[e.type];
      if (fn) fn(e, inner[0]);
    }
  }

  // O shadow root é "closed" (o site não consegue ler o popup), então composedPath() visto da
  // window para no host. Descobrimos o alvo real pelo ponto do clique ou pelo elemento focado.
  function innerPath(s, e) {
    const root = s.root;
    if (!root) return [];
    let el = null;
    const pointerLike =
      "clientX" in e && !(e.type === "click" && e.detail === 0); // detail 0 = Enter/Espaço
    if (pointerLike) el = root.elementFromPoint(e.clientX, e.clientY);
    if (!el) el = root.activeElement;
    const path = [];
    while (el && el !== root) {
      path.push(el);
      el = el.parentNode;
    }
    return path;
  }
  for (const t of FW_TYPES)
    window.addEventListener(t, firewall, {
      capture: true,
      passive: PASSIVE.has(t),
    });

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) on(el, k.slice(2), v);
      else if (v !== false && v != null)
        el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  function close(reason) {
    if (!current) return;
    const s = current;
    current = null;
    s.host.remove();
    for (const u of s.objectUrls) URL.revokeObjectURL(u);
    // devolve o foco para onde estava (ex.: o botão de anexar dentro do modal do site)
    try {
      if (s.prevFocus && s.prevFocus.isConnected)
        s.prevFocus.focus({ preventScroll: true });
    } catch (_) {}
    if (reason === "cancel")
      document.dispatchEvent(
        new CustomEvent(EVT_CANCEL, { detail: { id: s.id } }),
      );
  }

  function deliver(s, files) {
    if (!files.length) return;
    // detail atravessa para o MAIN world por structured clone (File é clonável)
    document.dispatchEvent(
      new CustomEvent(EVT_FILES, { detail: { id: s.id, files } }),
    );
    close("done");
  }

  function openNative(s) {
    const id = s.id;
    close("native");
    document.dispatchEvent(new CustomEvent(EVT_NATIVE, { detail: { id } }));
  }

  function showError(s, msg) {
    s.err.textContent = msg;
    s.err.classList.add("show");
  }

  function makeTile({ name, meta, thumbEl, disabled, onPick }) {
    const tile = h(
      "button",
      {
        class: "tile",
        type: "button",
        title: disabled ? "Tipo não aceito por este campo" : name,
        "aria-disabled": disabled ? "true" : "false",
      },
      h("div", { class: "thumb" }, thumbEl, h("span", { class: "check" }, "✓")),
      h("div", { class: "name" }, name),
      h("div", { class: "meta" }, meta),
      h("div", { class: "bar" }, h("i")),
    );
    on(tile, "click", (e) => {
      e.preventDefault();
      if (!disabled && !tile.classList.contains("busy")) onPick(tile, e);
    });
    return tile;
  }

  function docGlyph() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "30");
    svg.setAttribute("height", "30");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("class", "glyph");
    for (const d of [
      "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z",
      "M14 3v5h5",
    ]) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }

  function iconThumb(item) {
    const frag = document.createDocumentFragment();
    if (item.thumb && item.thumb.kind === "image")
      frag.append(h("img", { class: "full", src: item.thumb.src, alt: "" }));
    else if (item.thumb && item.thumb.src)
      frag.append(h("img", { class: "icon", src: item.thumb.src, alt: "" }));
    else frag.append(docGlyph());
    const ext = extOf(item.name);
    if (!(item.thumb && item.thumb.kind === "image") && ext)
      frag.append(h("span", { class: "ext" }, ext));
    return frag;
  }

  async function pickDownload(s, item, tile) {
    tile.classList.add("busy");
    const bar = tile.querySelector(".bar i");
    try {
      const file = await loadDownload(
        item,
        (p) => (bar.style.width = `${Math.round(p * 100)}%`),
      );
      return file;
    } catch (err) {
      showError(s, err.message);
      return null;
    } finally {
      tile.classList.remove("busy");
      bar.style.width = "0";
    }
  }

  function render(s, { clip, list }) {
    const host = h("div");
    host.setAttribute("data-uptray", "");
    const root = host.attachShadow({ mode: "closed" });
    s.root = root;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (_) {
      root.append(h("style", {}, CSS));
    }

    s.host = host;
    s.selected = new Map(); // chave -> { tile, get: async () => File }
    s.err = h("div", { class: "err", role: "alert" });

    const attachBtn = h(
      "button",
      { class: "btn primary", type: "button", hidden: true },
      "Anexar",
    );
    const browseBtn = h(
      "button",
      { class: "btn", type: "button" },
      "Procurar no computador…",
    );
    on(browseBtn, "click", () => openNative(s));

    const refreshAttach = () => {
      const n = s.selected.size;
      attachBtn.hidden = n === 0;
      attachBtn.textContent = n > 1 ? `Anexar ${n} arquivos` : "Anexar";
      browseBtn.classList.toggle("primary", n === 0);
    };
    browseBtn.classList.add("primary");

    on(attachBtn, "click", async () => {
      attachBtn.disabled = true;
      const files = [];
      for (const { get } of s.selected.values()) {
        const f = await get();
        if (!f) {
          attachBtn.disabled = false;
          return;
        }
        files.push(f);
      }
      deliver(s, files);
    });

    // Clique: seleção simples anexa direto; com "multiple", alterna a seleção
    const pick = (key, tile, get) => {
      if (!s.multiple) {
        get().then((f) => f && deliver(s, [f]));
        return;
      }
      if (s.selected.has(key)) {
        s.selected.delete(key);
        tile.classList.remove("sel");
      } else {
        s.selected.set(key, { tile, get });
        tile.classList.add("sel");
      }
      refreshAttach();
    };

    // --- área de transferência
    const clipSection = [h("h2", {}, "Área de transferência")];
    if (clip) {
      const url = URL.createObjectURL(clip);
      s.objectUrls.push(url);
      const tile = makeTile({
        name: "Imagem copiada",
        meta: `${fmtSize(clip.size)} · ${clip.type.split("/")[1].toUpperCase()}`,
        thumbEl: h("img", { class: "full", src: url, alt: "" }),
        disabled: !accepts(s.accept, clip.name, clip.type),
        onPick: (t) => pick("clip", t, async () => clip),
      });
      clipSection.push(h("div", { class: "grid" }, tile));
    } else {
      clipSection.push(
        h(
          "div",
          { class: "hint" },
          "Copiou um arquivo ou imagem? Pressione ",
          h("kbd", {}, "Ctrl"),
          " + ",
          h("kbd", {}, "V"),
          " aqui para anexar.",
        ),
      );
    }

    // --- downloads
    const dlSection = [h("h2", {}, "Downloads recentes")];
    const items = (list && list.items) || [];
    if (items.length) {
      const grid = h("div", { class: "grid" });
      for (const item of items) {
        const thumbBox = iconThumb(item);
        const tile = makeTile({
          name: item.name,
          meta: [fmtSize(item.size), ago(item.endTime)]
            .filter(Boolean)
            .join(" · "),
          thumbEl: thumbBox,
          disabled: !accepts(s.accept, item.name, item.mime),
          onPick: (t) =>
            pick("dl:" + item.id, t, () => pickDownload(s, item, t)),
        });
        grid.append(tile);
        // miniatura real de imagens chega depois, sem atrasar a abertura
        if (
          item.isImage &&
          !(item.thumb && item.thumb.kind === "image") &&
          list.fileAccess
        ) {
          send({ type: "thumb", id: item.id })
            .then((res) => {
              if (!res || !res.ok || !res.thumb) return;
              const box = tile.querySelector(".thumb");
              box
                .querySelectorAll("img, .ext, .glyph")
                .forEach((n) => n.remove());
              box.prepend(
                h("img", { class: "full", src: res.thumb.src, alt: "" }),
              );
            })
            .catch(() => {});
        }
      }
      dlSection.push(grid);
    } else {
      dlSection.push(
        h("div", { class: "hint" }, "Nenhum download recente encontrado."),
      );
    }
    if (list && list.fileAccess === false && items.length) {
      const btn = h(
        "button",
        { type: "button" },
        "Abrir configurações da extensão",
      );
      on(btn, "click", () => send({ type: "openSettings" }).catch(() => {}));
      dlSection.push(
        h(
          "div",
          { class: "notice" },
          "Para anexar downloads, ative ",
          h("b", {}, "Permitir acesso a URLs de arquivo"),
          " na extensão. ",
          btn,
        ),
      );
    }

    const closeBtn = h(
      "button",
      {
        class: "x",
        type: "button",
        title: "Fechar (Esc)",
        "aria-label": "Fechar",
      },
      "✕",
    );
    on(closeBtn, "click", () => close("cancel"));

    const card = h(
      "div",
      {
        class: "card",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Anexar arquivo",
      },
      h(
        "header",
        {},
        h("h1", {}, s.multiple ? "Anexar arquivos" : "Anexar arquivo"),
        closeBtn,
      ),
      h("div", { class: "body" }, clipSection, dlSection, s.err),
      h(
        "footer",
        {},
        h(
          "span",
          { class: "tip" },
          h("kbd", {}, "Ctrl"),
          "+",
          h("kbd", {}, "V"),
          " cola · ",
          h("kbd", {}, "Esc"),
          " fecha",
        ),
        attachBtn,
        browseBtn,
      ),
    );

    const backdrop = h("div", { class: "backdrop" }, card);
    on(backdrop, "mousedown", (_e, inner) => {
      if (inner === backdrop) close("cancel");
    });
    root.append(backdrop);

    // eventos globais enquanto aberto
    s.onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close("cancel");
      }
    };
    s.onPaste = (e) => {
      const files = Array.from(
        (e.clipboardData && e.clipboardData.files) || [],
      );
      e.preventDefault();
      e.stopPropagation();
      const ok = files.filter((f) => accepts(s.accept, f.name, f.type));
      if (ok.length) deliver(s, s.multiple ? ok : ok.slice(0, 1));
      else
        showError(
          s,
          files.length
            ? "O arquivo colado não é aceito por este campo."
            : "Não há arquivo nem imagem na área de transferência.",
        );
    };

    (document.body || document.documentElement).append(host);
    // foco no primeiro item útil
    const first =
      root.querySelector('.tile[aria-disabled="false"]') || browseBtn;
    first.focus({ preventScroll: true });
  }

  // ---------- entrada ----------
  document.addEventListener(EVT_OPEN, (e) => {
    const d = e.detail || {};
    if (
      !extensionAlive() ||
      !settings.enabled ||
      siteDisabled(d.host || location.hostname)
    )
      return;

    // assumimos o controle (inject.js não abre o seletor nativo)
    e.preventDefault();
    if (current) close("cancel");

    const s = {
      id: d.id,
      multiple: !!d.multiple,
      accept: d.accept || "",
      objectUrls: [],
      prevFocus: document.activeElement,
    };
    current = s;

    Promise.all([
      readClipboardImage(),
      send({ type: "list", max: settings.maxItems }).catch(() => null),
    ]).then(([clip, list]) => {
      if (current !== s) return;
      const nothing = !clip && !(list && list.items && list.items.length);
      if (nothing && !settings.alwaysShow) {
        // nada pra mostrar: vai direto pro Explorer (ainda dentro da janela de ativação do clique)
        current = null;
        document.dispatchEvent(
          new CustomEvent(EVT_NATIVE, { detail: { id: s.id } }),
        );
        return;
      }
      render(s, { clip, list });
    });
  });
})();
