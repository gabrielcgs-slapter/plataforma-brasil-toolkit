// content/content.js
// extractor.js já foi injetado antes (manifest content_scripts order)

(function () {
  if (window.__pbLoaded) return;
  window.__pbLoaded = true;

  // ── Constantes de polling ──────────────────────────────────────────────
  const POLL_TIMEOUT  = 30000;
  const POLL_INTERVAL = 300;
  const INITIAL_DELAY = 500;
  const MAX_PAGES     = 50;

  // ── Cache de preferências ──────────────────────────────────────────────
  // Lido uma vez no startup; atualizado via chrome.storage.onChanged.
  // Evita leitura assíncrona de storage a cada render AJAX em reapplyAll.
  const _prefs = { resizeTree: false, enlargeQuadro: false };

  function isExtensionContextValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  // ── Layout ─────────────────────────────────────────────────────────────

  function injectLayoutStyles() {
    const style = document.createElement('style');
    style.id = 'pb-toolkit-layout';
    style.textContent = `
      #geral         { width: 100% !important; max-width: none !important; }
      #conteudoImage { width: 100% !important; max-width: none !important; }
      #conteudoFull  { width: 100% !important; max-width: none !important; box-sizing: border-box !important; }
    `;
    document.head.appendChild(style);
  }

  function removeLayoutStyles() {
    document.getElementById('pb-toolkit-layout')?.remove();
  }

  const _ENLARGED_CSS = 'width: 90vw; max-width: 100vw; margin: 0; padding: 0; position: relative; left: 55%; right: 50%; margin-left: -50vw; margin-right: -50vw;';
  const _ENLARGED_SEL = '#formDetalharProjeto';

  // ── Atributos via config ────────────────────────────────────────────────

  const CONFIG_URL = chrome.runtime.getURL('config/attributes.json');

  // ── Ações ──────────────────────────────────────────────────────────────

  function actionCopyData() {
    const data = extractProjectData(document);
    const text = [
      `CAAE: ${data.caae ?? 'N/A'}`,
      `Título: ${data.titulo ?? 'N/A'}`,
      `Pesquisador Responsável: ${data.pesquisador ?? 'N/A'}`,
      `Área Temática: ${data.areaTematica ?? 'N/A'}`,
      `Patrocinador Principal: ${data.patrocinador ?? 'N/A'}`,
      `Emenda Atual: ${data.emendaAtual ?? 'N/A'}`,
      `Tipo de Centro: ${data.tipoCentro ?? 'N/A'}`,
    ].join('\n');
    return { ok: true, text };
  }

  function actionTogglePanels() {
    const panels = document.querySelectorAll('.rich-stglpanel-header');
    panels.forEach(header => header.click());
    return { ok: true, count: panels.length };
  }

  function applyEnlargeQuadro(enabled) {
    const el = document.querySelector(_ENLARGED_SEL);
    if (!el) return false;
    if (enabled) {
      el.setAttribute('style', _ENLARGED_CSS);
      el.dataset.pbEnlarged = 'true';
      injectLayoutStyles();
    } else {
      el.removeAttribute('style');
      delete el.dataset.pbEnlarged;
      removeLayoutStyles();
    }
    return true;
  }

  function actionAumentarQuadro(msg) {
    const enabled = Boolean(msg.enabled);
    const ok = applyEnlargeQuadro(enabled);
    if (!ok) return { ok: false, error: 'Formulário não encontrado' };
    return { ok: true, enlarged: enabled };
  }

  // ── Vigília "Aumentar quadro" (hardcoded p/ as URLs de _ENLARGE_WATCH_URLS) ──
  // Nesta página tudo navega via Ajax/JSF partial render: o documento NÃO
  // recarrega e a URL não muda, então o content script injeta uma única vez no
  // load e o #formDetalharProjeto é reconstruído a cada partial render (entrar
  // no projeto, abrir emenda, etc.). Mantemos um observer permanente que, com o
  // toggle ativo, reaplica o estilo sempre que o formulário reaparecer sem a
  // marcação. Casado também a chrome.storage para refletir o toggle na hora.
  const _ENLARGE_WATCH_URLS = [
    'https://plataformabrasil.saude.gov.br/visao/pesquisador/gerirPesquisa/gerirPesquisaAgrupador.jsf',
    'https://plataformabrasil.saude.gov.br/visao/administrador/4x4Novo/detalharProjetoRlCentroPartCop.jsf',
  ];

  function startEnlargeQuadroWatcher() {
    const base = location.href.split(/[?#]/)[0];
    if (!_ENLARGE_WATCH_URLS.includes(base)) return;
    if (window.__pbEnlargeWatcher) return;
    window.__pbEnlargeWatcher = true;

    // Observer declarado antes de enforce para poder desconectá-lo se a extensão
    // for recarregada com a aba aberta (contexto invalidado).
    let observer;
    const stopWatching = () => { observer?.disconnect(); };

    const enforce = () => {
      if (!isExtensionContextValid()) { stopWatching(); return; }
      try {
        chrome.storage.local.get('enlargeQuadro', function (result) {
          // chrome.runtime.lastError sinaliza contexto perdido no callback async.
          if (chrome.runtime.lastError) { stopWatching(); return; }
          if (!result.enlargeQuadro) return;
          const el = document.querySelector(_ENLARGED_SEL);
          if (el && el.dataset.pbEnlarged !== 'true') applyEnlargeQuadro(true);
        });
      } catch {
        // "Extension context invalidated" é lançado de forma síncrona quando a
        // extensão foi recarregada. Para de observar para não repetir no console.
        stopWatching();
      }
    };

    // Cada partial render Ajax substitui o formulário — reavalia a cada mutação.
    observer = new MutationObserver(enforce);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Toggle alternado no popup com a aba já aberta: aplica/remove imediatamente.
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && 'enlargeQuadro' in changes) {
        applyEnlargeQuadro(Boolean(changes.enlargeQuadro.newValue));
      }
    });

    enforce();
  }

  function findArvorePainel() {
    // j_id209 é auto-gerado pelo JSF e pode mudar com atualizações do servidor.
    // :has() garante que o resultado permanece dentro de #formDetalharProjeto.
    return document.querySelector('#formDetalharProjeto .rich-panel:has(.rich-tree)') ?? null;
  }

  function applyResizeArvore(enabled) {
    const painel = findArvorePainel();
    if (!painel) return false;
    if (enabled) {
      painel.style.resize = 'both';
      painel.style.overflow = 'auto';
      painel.style.minWidth = '300px';
      painel.style.maxWidth = '540px';
      painel.style.minHeight = '200px';
      painel.style.maxHeight = '800px';

    } else {
      painel.style.resize = '';
      painel.style.overflow = '';
      painel.style.minWidth = '';
      painel.style.maxWidth = '';
      painel.style.minHeight = '';
      painel.style.maxHeight = '';
    }
    return true;
  }

  function actionRedimensionarArvore(msg) {
    const ok = applyResizeArvore(Boolean(msg.enabled));
    if (!ok) return { ok: false, error: 'Painel da árvore não encontrado' };
    return { ok: true, enabled: Boolean(msg.enabled) };
  }

  function actionAbrirArvore() {
    let count = 0;
    document.querySelectorAll('.rich-tree-node-handle').forEach(handle => {
      const collapsed = handle.querySelector('.rich-tree-node-handleicon-collapsed');
      if (collapsed && collapsed.style.display !== 'none') {
        handle.click();
        count++;
      }
    });
    return { ok: true, count };
  }

  function findNotificacaoBtn(doc) {
    const table = doc.querySelector('#formDetalharProjeto\\:tabelaApreciacoesProjetos');
    if (!table) return null;
    return table.querySelector('a img[src*="ico_notificar.png"]')?.closest('a') ?? null;
  }

  function findFastforwardBtn(doc) {
    const table = doc.querySelector('#formDetalharProjeto\\:tabelaApreciacoesProjetos');
    if (!table) return null;
    return table.querySelector('td.rich-datascr-button[onclick*="fastforward"]') ?? null;
  }

  // Header ordenável "Apreciação" da tabela de apreciações. O id é gerado pelo
  // JSF (j_id*), então casamos pelo texto do <span> dentro do <a>.
  function findSortApreciacaoBtn(doc) {
    const table = doc.querySelector('#formDetalharProjeto\\:tabelaApreciacoesProjetos');
    if (!table) return null;
    for (const a of table.querySelectorAll('a.rich-table-sortable-header')) {
      const span = a.querySelector('span');
      if (span && span.textContent.trim() === 'Apreciação') return a;
    }
    return null;
  }

  function waitForTableChange(tableEl, timeout = 5000, debounce = 300) {
    return new Promise((resolve, reject) => {
      let debounceTimer;
      const globalTimer = setTimeout(() => {
        clearTimeout(debounceTimer);
        observer.disconnect();
        reject(new Error('Timeout aguardando atualização da tabela'));
      }, timeout);
      const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          clearTimeout(globalTimer);
          observer.disconnect();
          resolve();
        }, debounce);
      });
      observer.observe(tableEl, { childList: true, subtree: true });
    });
  }

  function findEmendaBtn(doc) {
    const table = doc.querySelector('#formDetalharProjeto\\:tabelaApreciacoesProjetos');
    if (!table) return null;
    return table.querySelector('a img[src*="ico_adicionar.png"], a img[src*="ico_editar.png"]')?.closest('a') ?? null;
  }

  async function paginateUntilFound(findFn, notFoundMsg, { sortFn } = {}) {
    const table = document.querySelector('#formDetalharProjeto\\:tabelaApreciacoesProjetos');
    if (!table) return { ok: false, error: notFoundMsg };

    let sorted = false;
    for (let i = 0; i < MAX_PAGES; i++) {
      const btn = findFn(document);
      if (btn) { btn.click(); return { ok: true }; }

      // Antes de paginar, ordena a tabela uma única vez para trazer a apreciação
      // relevante para a página visível, e procura o botão de novo.
      if (!sorted && sortFn) {
        sorted = true;
        const sortBtn = sortFn(document);
        if (sortBtn) {
          sortBtn.click();
          try {
            await waitForTableChange(table, POLL_TIMEOUT, POLL_INTERVAL);
          } catch {
            return { ok: false, error: 'Timeout aguardando carregamento da página' };
          }
          continue;
        }
      }

      const pgBtn = findFastforwardBtn(document);
      if (!pgBtn) return { ok: false, error: notFoundMsg };
      pgBtn.click();
      try {
        await waitForTableChange(table, POLL_TIMEOUT, POLL_INTERVAL);
      } catch {
        return { ok: false, error: 'Timeout aguardando carregamento da página' };
      }
    }
    return { ok: false, error: `${notFoundMsg} após percorrer todas as páginas` };
  }

  async function actionSubmeterEmenda() {
    return paginateUntilFound(findEmendaBtn, 'Botão de submeter emenda não encontrado');
  }

  const PB_PENDING_DETALHAR = 'pb_pendingDetalhar';

  async function actionBuscarProjeto({ caae }) {
    const field = document.getElementById('gerirPesquisaForm:nuCAEE');
    if (!field) return { ok: false, error: 'Campo CAAE não encontrado' };

    const btn = document.getElementById('gerirPesquisaForm:idBtnBuscarProjPesquisa');
    if (!btn) return { ok: false, error: 'Botão de busca não encontrado' };

    const clearFields = ['gerirPesquisaForm:titulo', 'gerirPesquisaForm:noPesquisadorPrincipal', 'gerirPesquisaForm:palavraChave'];
    for (const id of clearFields) {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.dispatchEvent(new Event('change')); }
    }
    const tipoVinculo = document.querySelector('#gerirPesquisaForm select[onkeypress*="hotKeyPesquisar"]');
    if (tipoVinculo) { tipoVinculo.value = ''; tipoVinculo.dispatchEvent(new Event('change')); }

    field.value = caae;
    field.dispatchEvent(new Event('change'));

    // Flag set before click — survives full-page navigation (sessionStorage is tab-scoped)
    sessionStorage.setItem(PB_PENDING_DETALHAR, '1');

    // If search triggers full reload, script dies here and flag is picked up on new load.
    // If search is AJAX, observer/polling below finds Detalhar on same page.
    const statusStop  = document.getElementById('_viewRoot:status.stop');
    const statusStart = document.getElementById('_viewRoot:status.start');

    const found = await new Promise(resolve => {
      let done = false;
      let observer = null;
      let timeoutHandle;

      function tryClickDetalhar() {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        clearTimeout(timeoutHandle);
        // Extra delay to ensure DOM is fully rendered after AJAX completes
        setTimeout(() => {
          const detalhar = document.querySelector('[title="Detalhar"]');
          if (detalhar) {
            sessionStorage.removeItem(PB_PENDING_DETALHAR);
            detalhar.click();
            resolve(true);
          } else {
            resolve(false);
          }
        }, 300);
      }

      if (statusStop && statusStart) {
        // Primary: watch RichFaces AJAX status indicators
        // During AJAX: status.start visible, status.stop hidden (display:none)
        // After AJAX:  status.stop visible again, status.start hidden
        observer = new MutationObserver(mutations => {
          for (const mutation of mutations) {
            if (mutation.attributeName !== 'style') continue;
            const stopStyle  = statusStop.getAttribute('style')  || '';
            const startStyle = statusStart.getAttribute('style') || '';
            const ajaxDone   = !/display:\s*none/i.test(stopStyle) &&
                               /display:\s*none/i.test(startStyle);
            if (ajaxDone) tryClickDetalhar();
          }
        });
        // Observer must be set up BEFORE btn.click() to avoid race condition
        observer.observe(statusStop,  { attributes: true, attributeFilter: ['style'] });
        observer.observe(statusStart, { attributes: true, attributeFilter: ['style'] });

        timeoutHandle = setTimeout(() => {
          if (!done) tryClickDetalhar();
        }, POLL_TIMEOUT);
      } else {
        // Fallback: polling (status elements not found — different page structure)
        const maxAttempts = Math.ceil(POLL_TIMEOUT / POLL_INTERVAL);
        let attempts = 0;
        timeoutHandle = setTimeout(() => {
          const timer = setInterval(() => {
            const detalhar = document.querySelector('[title="Detalhar"]');
            if (detalhar) {
              clearInterval(timer);
              sessionStorage.removeItem(PB_PENDING_DETALHAR);
              detalhar.click();
              resolve(true);
            } else if (++attempts >= maxAttempts) {
              clearInterval(timer);
              resolve(false);
            }
          }, POLL_INTERVAL);
        }, 800);
      }

      btn.click();
    });

    if (!found) {
      sessionStorage.removeItem(PB_PENDING_DETALHAR);
      return { ok: false, error: 'Botão Detalhar não encontrado após busca' };
    }
    return { ok: true };
  }

  async function actionSubmeterNotificacao() {
    return paginateUntilFound(findNotificacaoBtn, 'Botão de notificação não encontrado', {
      sortFn: findSortApreciacaoBtn,
    });
  }

  // ── Abrir projeto salvo ────────────────────────────────────────────────
  // A lista é paginada server-side (≈10 por página), então jsfcljs/Detalhar só
  // funciona para linhas visíveis na página atual. Para abrir um protocolo salvo,
  // o popup chama 'buscarProjeto' (actionBuscarProjeto): filtra pelo CAAE e clica
  // no Detalhar quando a lista filtrada carrega.

  function actionExtractProtocolData() {
    const data = extractProjectData(document);
    if (!data.caae) return { ok: false, error: 'CAAE não encontrado nesta página' };
    return { ok: true, caae: data.caae, projectId: data.projectId ?? null };
  }


  function actionImprimir() {
    window.print();
    return { ok: true };
  }

  // ── Listener ──────────────────────────────────────────────────────────

  const ACTIONS = {
    copyData:             actionCopyData,
    togglePanels:         actionTogglePanels,
    aumentarQuadro:       actionAumentarQuadro,
    abrirArvore:          actionAbrirArvore,
    redimensionarArvore:  actionRedimensionarArvore,
    submeterNotificacao:  actionSubmeterNotificacao,
    submeterEmenda:       actionSubmeterEmenda,
    buscarProjeto:        actionBuscarProjeto,
    extractProtocolData:  actionExtractProtocolData,
    imprimir:             actionImprimir,
  };

  // ── Reaplicação após render parcial (RichFaces A4J) ─────────────────────
  // Cada clique em botão dispara render parcial AJAX que reconstrói o DOM,
  // descartando as marcações/estilos da extensão. Reaplica tudo ao fim do AJAX.

  function reapplyAll() {
    if (!isExtensionContextValid()) return;
    applyAttributeConfig(CONFIG_URL, document, 'load').catch(() => {});
    if (_prefs.resizeTree) applyResizeArvore(true);
    if (_prefs.enlargeQuadro) applyEnlargeQuadro(true);
  }

  function installReapplyObserver() {
    if (window.__pbReapplyInstalled) return;
    window.__pbReapplyInstalled = true;

    let debounceTimer;
    const schedule = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(reapplyAll, 200);
    };

    const statusStop  = document.getElementById('_viewRoot:status.stop');
    const statusStart = document.getElementById('_viewRoot:status.start');

    if (statusStop && statusStart) {
      // Indicadores A4J: status.stop volta a ficar visível quando o AJAX termina.
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.attributeName !== 'style') continue;
          const stopStyle  = statusStop.getAttribute('style')  || '';
          const startStyle = statusStart.getAttribute('style') || '';
          const ajaxDone   = !/display:\s*none/.test(stopStyle) &&
                             /display:\s*none/.test(startStyle);
          if (ajaxDone) schedule();
        }
      });
      observer.observe(statusStop,  { attributes: true, attributeFilter: ['style'] });
      observer.observe(statusStart, { attributes: true, attributeFilter: ['style'] });
    } else {
      // Fallback: observa mutações estruturais no body (status A4J ausente).
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Aplicação inicial: prefs carregam tarde via RichFaces, então faz retry curto.
  reapplyAll();

  chrome.storage.local.get('resizeTree', function (result) {
    if (!result.resizeTree) return;
    const _deadline = Date.now() + 15000;
    (function _tryApply() {
      if (!isExtensionContextValid()) return;
      if (applyResizeArvore(true)) return;
      if (Date.now() < _deadline) setTimeout(_tryApply, 300);
    })();
  });

  chrome.storage.local.get('enlargeQuadro', function (result) {
    if (!result.enlargeQuadro) return;
    const _deadline = Date.now() + 15000;
    (function _tryApply() {
      if (!isExtensionContextValid()) return;
      if (applyEnlargeQuadro(true)) return;
      if (Date.now() < _deadline) setTimeout(_tryApply, 300);
    })();
  });

  // Carrega _prefs uma vez; mantém sincronizado via onChanged.
  chrome.storage.local.get(['resizeTree', 'enlargeQuadro'], function (result) {
    _prefs.resizeTree   = Boolean(result.resizeTree);
    _prefs.enlargeQuadro = Boolean(result.enlargeQuadro);
  });
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if ('resizeTree'    in changes) _prefs.resizeTree   = Boolean(changes.resizeTree.newValue);
    if ('enlargeQuadro' in changes) _prefs.enlargeQuadro = Boolean(changes.enlargeQuadro.newValue);
  });

  installReapplyObserver();
  startEnlargeQuadroWatcher();

  // Auto-click Detalhar if a buscarProjeto triggered full-page navigation
  if (sessionStorage.getItem(PB_PENDING_DETALHAR)) {
    sessionStorage.removeItem(PB_PENDING_DETALHAR);
    const _deadline = Date.now() + 15000;
    setTimeout(function _checkDetalhar() {
      const detalhar = document.querySelector('[title="Detalhar"]');
      if (detalhar) { detalhar.click(); return; }
      if (Date.now() < _deadline) setTimeout(_checkDetalhar, 300);
    }, 500);
  }

  window.__pbExt = {
    runAction(action, msg = {}) {
      const fn = ACTIONS[action];
      if (!fn) return Promise.resolve({ ok: false, error: `Ação desconhecida: ${action}` });
      return Promise.resolve().then(() => fn(msg));
    },
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    const fn = ACTIONS[msg.action];
    if (!fn) {
      sendResponse({ ok: false, error: `Ação desconhecida: ${msg.action}` });
      return;
    }
    Promise.resolve()
      .then(() => fn(msg))
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // mantém canal aberto para resposta async
  });
})();
