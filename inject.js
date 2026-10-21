// Uptray — roda no "MAIN world" (mesmo contexto JS da página).
// Função: interceptar a abertura do seletor de arquivos e avisar o content script
// (isolated world), que desenha o popup. Se o content script não responder
// (extensão desativada, recarregada, site excluído), abre o seletor nativo normalmente.
(() => {
  if (window.__uptrayInjected) return;
  Object.defineProperty(window, "__uptrayInjected", { value: true });

  const EVT_OPEN = "uptray:open";
  const EVT_NATIVE = "uptray:native";
  const EVT_FILES = "uptray:files";

  const proto = HTMLInputElement.prototype;
  const origClick = proto.click;
  const origShowPicker = proto.showPicker;

  const inputs = new Map(); // id -> input
  let seq = 0;
  let bypass = false;

  const isFileInput = (el) =>
    el instanceof HTMLInputElement && el.type === "file" && !el.disabled;

  // Pergunta ao content script se ele assume o controle.
  // dispatchEvent é síncrono: se ele chamou preventDefault, retorna false.
  function claim(input) {
    const id = String(++seq);
    inputs.set(id, input);
    const evt = new CustomEvent(EVT_OPEN, {
      cancelable: true,
      detail: {
        id,
        multiple: !!input.multiple,
        accept: input.accept || "",
        host: location.hostname,
      },
    });
    const claimed = !document.dispatchEvent(evt);
    if (!claimed) inputs.delete(id);
    return claimed;
  }

  function openNative(input) {
    bypass = true;
    try {
      origClick.call(input);
    } finally {
      bypass = false;
    }
  }

  // input.click() chamado pelo próprio site (padrão de botão que aciona input escondido)
  proto.click = function () {
    if (!bypass && isFileInput(this) && claim(this)) return;
    return origClick.apply(this, arguments);
  };

  // input.showPicker() (API mais nova)
  if (typeof origShowPicker === "function") {
    proto.showPicker = function () {
      if (!bypass && isFileInput(this) && claim(this)) return;
      return origShowPicker.apply(this, arguments);
    };
  }

  // Clique direto do usuário no <input type=file> ou num <label> ligado a ele
  window.addEventListener(
    "click",
    (e) => {
      if (bypass || e.defaultPrevented) return;
      const target = e.target;
      if (!isFileInput(target)) return;
      if (claim(target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  // Usuário clicou em "Procurar no computador…" no popup
  document.addEventListener(EVT_NATIVE, (e) => {
    const id = e.detail && e.detail.id;
    const input = inputs.get(id);
    inputs.delete(id);
    if (input) openNative(input);
  });

  // Usuário escolheu arquivos no popup: entregamos ao input como se viessem do Explorer
  document.addEventListener(EVT_FILES, (e) => {
    const detail = e.detail || {};
    const input = inputs.get(detail.id);
    inputs.delete(detail.id);
    if (!input || !Array.isArray(detail.files)) return;

    const dt = new DataTransfer();
    const files = input.multiple ? detail.files : detail.files.slice(0, 1);
    for (const f of files) if (f instanceof File) dt.items.add(f);
    if (!dt.files.length) return;

    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // Cancelamento: alguns sites escutam o evento "cancel" do input
  document.addEventListener("uptray:cancel", (e) => {
    const id = e.detail && e.detail.id;
    const input = inputs.get(id);
    inputs.delete(id);
    if (input) input.dispatchEvent(new Event("cancel", { bubbles: false }));
  });
})();
