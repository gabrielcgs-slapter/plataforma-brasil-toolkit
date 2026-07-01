// popup/overlay-init.js — inicialização exclusiva do overlay (não do popup normal)

document.getElementById('btn-overlay-close').addEventListener('click', () => {
  chrome.storage.local.set({ showOverlay: false });
});

// Minimizar: oculta tudo exceto o header via classe CSS, o ResizeObserver
// detecta a mudança de altura e o parent redimensiona o iframe automaticamente.
const btnMinimize = document.getElementById('btn-overlay-minimize');

// setMinimized centraliza a transição (classe + ícone + reportSize) para que o
// botão (toggle) e o Esc (apenas minimiza) compartilhem o mesmo caminho.
function setMinimized(min) {
  document.body.classList.toggle('minimized', min);
  btnMinimize.querySelector('i').className = min ? 'fa-solid fa-plus' : 'fa-solid fa-minus';
  reportSize();
}

btnMinimize.addEventListener('click', () => {
  setMinimized(!document.body.classList.contains('minimized'));
});

// O header dispara drag via postMessage para o content script no parent,
// que gerencia o arrasto fora do iframe para capturar eventos globais de mouse.
// ancestorOrigins[0] é o origin do frame pai (Chrome-only, mas somos MV3).
const _parentOrigin = window.location.ancestorOrigins?.[0] ?? '*';

document.getElementById('header').addEventListener('mousedown', e => {
  if (e.target.closest('button')) return;
  window.parent.postMessage({ __pbDragStart: { x: e.clientX, y: e.clientY } }, _parentOrigin);
  e.preventDefault();
});

// Reporta as dimensões ao parent: altura via scrollHeight; largura via classe
// .wide (evita scrollWidth que pode incluir artefatos de layout).
function reportSize() {
  window.parent.postMessage({
    __pbOverlaySize: {
      h: document.body.scrollHeight,
      w: document.body.classList.contains('wide') ? 300 : 240,
    },
  }, _parentOrigin);
}
new ResizeObserver(reportSize).observe(document.body);
reportSize();

// ── Esc minimiza quando o painel está "em evidência" (último clicado) ───────
// "Em evidência" = o painel foi o último elemento clicado. Qualquer mousedown
// dentro do iframe o põe em evidência; quando um clique cai na página, o parent
// avisa via mensagem e a evidência cai. Espelhamos o estado no parent para que
// ele decida sincronamente se "consome" o Esc (preventDefault) ou o deixa
// seguir para a página (fechar modais do RichFaces etc.).
let evidencia = false;

document.addEventListener('mousedown', () => {
  evidencia = true;
  window.parent.postMessage({ __pbOverlayAtivo: true }, _parentOrigin);
});

function minimizarPorEsc() {
  if (evidencia && !document.body.classList.contains('minimized')) {
    setMinimized(true);
  }
}

// Foco dentro do iframe: o keydown do Esc chega aqui diretamente.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') minimizarPorEsc();
});

// Mensagens do parent: perda de evidência (clique na página) e repasse do Esc
// (foco na página, ex.: logo após arrastar o painel, que dá preventDefault no
// mousedown e impede o foco de migrar para o iframe).
window.addEventListener('message', e => {
  if (_parentOrigin !== '*' && e.origin !== _parentOrigin) return;
  if (e.data?.__pbOverlayDeactivate) evidencia = false;
  else if (e.data?.__pbOverlayEsc) minimizarPorEsc();
});
