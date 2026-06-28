// popup/overlay-init.js — inicialização exclusiva do overlay (não do popup normal)

document.getElementById('btn-overlay-close').addEventListener('click', () => {
  chrome.storage.local.set({ showOverlay: false });
});

// Minimizar: oculta tudo exceto o header via classe CSS, o ResizeObserver
// detecta a mudança de altura e o parent redimensiona o iframe automaticamente.
const btnMinimize = document.getElementById('btn-overlay-minimize');
btnMinimize.addEventListener('click', () => {
  const minimized = document.body.classList.toggle('minimized');
  btnMinimize.querySelector('i').className = minimized ? 'fa-solid fa-plus' : 'fa-solid fa-minus';
  reportSize();
});

// O header dispara drag via postMessage para o content script no parent,
// que gerencia o arrasto fora do iframe para capturar eventos globais de mouse.
document.getElementById('header').addEventListener('mousedown', e => {
  if (e.target.closest('button')) return;
  window.parent.postMessage({ __pbDragStart: { x: e.clientX, y: e.clientY } }, '*');
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
  }, '*');
}
new ResizeObserver(reportSize).observe(document.body);
reportSize();
