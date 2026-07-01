// content/overlay.js
(function () {
  if (window.__pbOverlayLoaded) return;
  window.__pbOverlayLoaded = true;

  let host = null;
  let iframe = null;
  let dragCover = null;
  let overlayAtivo = false; // espelho de "em evidência" reportado pelo iframe

  // No document_start, document.body ainda não existe. Adia a criação até o body
  // aparecer para que a overlay surja o mais cedo possível, sem esperar o
  // document_idle (JSF carrega devagar e isso causava o sumiço a cada navegação).
  function createOverlay() {
    if (host) return;
    if (!document.body) {
      const obs = new MutationObserver(() => {
        if (document.body) { obs.disconnect(); createOverlay(); }
      });
      obs.observe(document.documentElement, { childList: true });
      return;
    }

    host = document.createElement('div');
    host.id = '__pb-overlay-host';
    Object.assign(host.style, {
      position:     'fixed',
      bottom:       '20px',
      right:        '20px',
      zIndex:       '2147483647',
      borderRadius: '8px',
      boxShadow:    '0 8px 32px rgba(0,0,0,0.45)',
      overflow:     'hidden',
      width:        '240px',
    });

    iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('popup/overlay.html');
    iframe.title = 'Plataforma Brasil Toolkit';
    Object.assign(iframe.style, {
      display: 'block',
      width:   '240px',
      height:  '400px',
      border:  'none',
    });
    iframe.allow = 'clipboard-write';

    host.appendChild(iframe);
    document.body.appendChild(host);

    // ── Mensagens do iframe ─────────────────────────────────────────────────
    window.addEventListener('message', onIframeMessage);
    document.addEventListener('mousedown', onPageMouseDown, true);
    document.addEventListener('keydown',   onPageKeyDown,   true);
  }

  // Drag: o iframe envia __pbDragStart com as coordenadas do mouse relativas ao
  // viewport do iframe. Convertemos para o viewport da página somando o offset
  // do iframe e iniciamos o arrasto com um cover transparente para capturar
  // eventos de mouse globais enquanto o cursor está sobre o iframe.
  // Só aceita mensagens vindas do iframe da própria extensão.
  const _extOrigin = new URL(chrome.runtime.getURL('')).origin;

  function onIframeMessage(e) {
    if (!host) return;
    if (e.origin !== _extOrigin) return;

    if (e.data?.__pbOverlayAtivo) overlayAtivo = true;

    if (e.data?.__pbOverlaySize) {
      const { h, w } = e.data.__pbOverlaySize;
      if (iframe) iframe.style.height = Math.max(h, 50) + 'px';
      if (host)   host.style.width    = Math.max(w, 100) + 'px';
      if (iframe) iframe.style.width  = Math.max(w, 100) + 'px';
    }

    if (e.data?.__pbDragStart) {
      const fr = iframe.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      const pageX = fr.left + e.data.__pbDragStart.x;
      const pageY = fr.top  + e.data.__pbDragStart.y;
      const ox = pageX - hr.left;
      const oy = pageY - hr.top;
      startDrag(ox, oy);
    }
  }

  // ── Evidência do painel + Esc ─────────────────────────────────────────────
  // overlayAtivo espelha "em evidência" reportado pelo iframe. Um clique na
  // página derruba a evidência e avisa o iframe. O Esc só é "consumido"
  // (preventDefault) quando o painel está em evidência; caso contrário segue
  // intacto para a página (fechar modais do RichFaces, cancelar campos etc.).
  function onPageMouseDown(e) {
    if (host && host.contains(e.target)) return; // clique no próprio painel
    overlayAtivo = false;
    iframe?.contentWindow?.postMessage({ __pbOverlayDeactivate: true }, _extOrigin);
  }

  function onPageKeyDown(e) {
    if (e.key !== 'Escape' || !overlayAtivo) return;
    e.preventDefault();
    e.stopPropagation();
    iframe?.contentWindow?.postMessage({ __pbOverlayEsc: true }, _extOrigin);
  }

  function startDrag(ox, oy) {
    // pointer-events:none no iframe faz os eventos de mouse passarem
    // para o cover e chegarem ao document do parent (incluindo mouseup).
    iframe.style.pointerEvents = 'none';

    dragCover = document.createElement('div');
    Object.assign(dragCover.style, {
      position: 'fixed',
      inset:    '0',
      zIndex:   '2147483647',
      cursor:   'grabbing',
    });
    document.body.appendChild(dragCover);

    function onMove(e) {
      host.style.right  = 'auto';
      host.style.bottom = 'auto';
      host.style.left   = (e.clientX - ox) + 'px';
      host.style.top    = (e.clientY - oy) + 'px';
    }

    function onUp() {
      iframe.style.pointerEvents = '';
      dragCover.remove();
      dragCover = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  function destroyOverlay() {
    window.removeEventListener('message', onIframeMessage);
    document.removeEventListener('mousedown', onPageMouseDown, true);
    document.removeEventListener('keydown',   onPageKeyDown,   true);
    dragCover?.remove();
    dragCover = null;
    host?.remove();
    host   = null;
    iframe = null;
    overlayAtivo = false;
  }

  // ── Inicialização ─────────────────────────────────────────────────────────
  chrome.storage.local.get('showOverlay', result => {
    if (result.showOverlay) createOverlay();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('showOverlay' in changes)) return;
    if (changes.showOverlay.newValue) createOverlay();
    else destroyOverlay();
  });
})();
