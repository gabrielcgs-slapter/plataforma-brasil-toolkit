// popup/popup.js

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Fonte única: deriva os patterns das `matches` do content script no manifest.
// Evita manter duas listas em sincronia (manifest.json + popup.js).
const PB_PATTERNS = (() => {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  const entry = scripts.find(s => (s.js ?? []).some(f => f.includes('content/content.js')));
  return (entry?.matches ?? [])
    .map(m => m.replace(/^https?:\/\/[^/]+\//, '').replace(/\*/g, ''))
    .filter(Boolean);
})();

function isPlataformaBrasil(url) {
  return url && PB_PATTERNS.some(p => url.includes(p));
}

function isGerirPesquisaPage(url) {
  return url?.includes('gerirPesquisaAgrupador.jsf');
}

function showFeedback(msg, isError = false) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.className = isError ? 'feedback-err' : 'feedback-ok';
  setTimeout(() => { el.textContent = ''; el.className = ''; }, 3000);
}

const CONTENT_SCRIPTS = [
  'lib/extractor.js',
  'content/attribute-config.js',
  'content/content.js',
];

function tryMessage(tabId, action, payload = {}) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { action, ...payload }, response => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, _err: chrome.runtime.lastError.message });
      } else {
        resolve(response ?? { ok: false, error: 'Sem resposta do content script' });
      }
    });
  });
}

async function sendAction(tabId, action, payload = {}) {
  const first = await tryMessage(tabId, action, payload);
  if (!first._err) return first;

  if (!first._err.includes('Receiving end does not exist')) {
    return { ok: false, error: first._err };
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
  } catch {
    // script já injetado (IIFE guard ativo) — ok continuar
  }

  const second = await tryMessage(tabId, action, payload);
  if (second._err) return { ok: false, error: second._err };
  return second;
}

const FEEDBACK_MESSAGES = {
  copyData:       r => r.ok ? 'Dados copiados!' : `Erro: ${r.error}`,
  togglePanels:   r => r.ok ? `${r.count} seções alternadas` : `Erro: ${r.error}`,
  abrirArvore:    r => r.ok ? `${r.count} nós expandidos` : `Erro: ${r.error}`,
  submeterNotificacao: r => r.ok ? 'Notificação submetida!' : `Erro: ${r.error}`,
  submeterEmenda:      r => r.ok ? 'Emenda submetida!' : `Erro: ${r.error}`,
};

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btn-preferences').addEventListener('click', () => {
    showView('preferences');
  });

  document.getElementById('btn-pref-back').addEventListener('click', () => {
    showView('actions');
  });

  // ── Preferências ──────────────────────────────────────────────────────────
  const toggleHideBanner = document.getElementById('toggle-hide-banner');
  const prefStored = await chrome.storage.local.get('hideLoginBanner');
  toggleHideBanner.checked = Boolean(prefStored.hideLoginBanner);
  toggleHideBanner.addEventListener('change', async () => {
    await chrome.storage.local.set({ hideLoginBanner: toggleHideBanner.checked });
  });

  const tab = await getActiveTab();
  const onPage = isPlataformaBrasil(tab?.url ?? '');
  const onGerirPage = isGerirPesquisaPage(tab?.url ?? '');

  const toggleResizeTree = document.getElementById('toggle-resize-tree');
  const resizeStored = await chrome.storage.local.get('resizeTree');
  toggleResizeTree.checked = Boolean(resizeStored.resizeTree);
  toggleResizeTree.addEventListener('change', async () => {
    const enabled = toggleResizeTree.checked;
    await chrome.storage.local.set({ resizeTree: enabled });
    if (onPage && tab?.id !== undefined) {
      await sendAction(tab.id, 'redimensionarArvore', { enabled });
    }
  });

  const toggleEnlarge = document.getElementById('toggle-enlarge-quadro');
  const enlargeStored = await chrome.storage.local.get('enlargeQuadro');
  toggleEnlarge.checked = Boolean(enlargeStored.enlargeQuadro);
  toggleEnlarge.addEventListener('change', async () => {
    const enabled = toggleEnlarge.checked;
    await chrome.storage.local.set({ enlargeQuadro: enabled });
    if (onPage && tab?.id !== undefined) {
      await sendAction(tab.id, 'aumentarQuadro', { enabled });
    }
  });

  document.getElementById('status-dot').className = `dot ${onPage ? 'dot-on' : 'dot-off'}`;
  document.getElementById('status-dot').title = onPage
    ? 'Página Plataforma Brasil detectada'
    : 'Página não é Plataforma Brasil';

  if (!onPage) document.getElementById('btn-open-protocols').disabled = true;

  document.querySelectorAll('.btn[data-action]').forEach(btn => {
    if (!onPage) { btn.disabled = true; return; }

    const action = btn.dataset.action;

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const response = await sendAction(tab.id, action);

      if (action === 'copyData' && response.ok) {
        try {
          await navigator.clipboard.writeText(response.text);
        } catch (e) {
          showFeedback(`Erro ao copiar: ${e.message}`, true);
          btn.disabled = false;
          return;
        }
      }

      const msg = FEEDBACK_MESSAGES[action]?.(response) ?? (response.ok ? 'OK' : response.error);
      showFeedback(msg, !response.ok);

      btn.disabled = false;
    });
  });

  if (!onGerirPage) {
    document.getElementById('btn-show-add').disabled = true;
  }

  // ── Painel de Protocolos ────────────────────────────────────────────────

  const actionsEl       = document.getElementById('actions');
  const protocolsPanel  = document.getElementById('protocols-panel');
  const protocolsList   = document.getElementById('protocols-list');
  const protocolsForm   = document.getElementById('protocols-form');
  const inputNome       = document.getElementById('input-nome');
  const caaeAutoEl      = document.getElementById('protocols-caae-auto');
  const caaeValueEl     = document.getElementById('protocols-caae-value');

  let _autoProtocolData = null; // { caae, projectId } quando extraído da página

  const preferencesPanel = document.getElementById('preferences-panel');

  function showView(view) {
    actionsEl.classList.toggle('hidden', view !== 'actions');
    protocolsPanel.classList.toggle('hidden', view !== 'protocols');
    preferencesPanel.classList.toggle('hidden', view !== 'preferences');
    document.body.classList.toggle('wide', view === 'protocols');
  }

  function makeProtocolItem(p, i) {
    const item = document.createElement('div');
    item.className = 'protocol-item';
    item.dataset.index = String(i);
    item.dataset.protocol = JSON.stringify({
      projectId: p.projectId ?? null,
      caae: p.caae,
      nome: p.nome,
    });
    item.title = 'Clique para buscar e abrir projeto';

    const info = document.createElement('div');
    info.className = 'protocol-item-info';

    const nome = document.createElement('div');
    nome.className = 'protocol-nome';
    nome.title = p.nome;
    nome.textContent = p.nome;

    const caae = document.createElement('div');
    caae.className = 'protocol-caae';
    caae.title = p.caae;
    caae.textContent = p.caae;

    info.appendChild(nome);
    info.appendChild(caae);

    const btnDel = document.createElement('button');
    btnDel.className = 'btn-del';
    btnDel.dataset.index = String(i);
    btnDel.title = 'Remover';
    const trashIcon = document.createElement('i');
    trashIcon.className = 'fa-solid fa-trash';
    btnDel.appendChild(trashIcon);

    item.appendChild(info);
    item.appendChild(btnDel);
    return item;
  }

  function renderProtocols(list) {
    protocolsList.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = '#999';
      empty.style.fontSize = '11px';
      empty.style.padding = '4px 0';
      empty.textContent = 'Nenhum protocolo adicionado.';
      protocolsList.appendChild(empty);
      return;
    }
    list.forEach((p, i) => {
      protocolsList.appendChild(makeProtocolItem(p, i));
    });

    protocolsList.querySelectorAll('.protocol-item').forEach(item => {
      if (!onPage) {
        item.classList.add('disabled');
        return;
      }
      item.addEventListener('click', async () => {
        let p;
        try {
          p = JSON.parse(item.dataset.protocol);
        } catch {
          return;
        }
        if (!p || !p.caae) return;

        // A lista de projetos é paginada server-side (≈10 por página), então abrir
        // direto pelo projectId só funciona se a linha estiver na página atual.
        // Buscar pelo CAAE filtra a lista para 1 resultado e então clica em Detalhar.
        item.classList.add('disabled');
        const response = await sendAction(tab.id, 'buscarProjeto', { caae: p.caae });
        showFeedback(
          response.ok ? `Abrindo ${p.nome}...` : `Erro: ${response.error}`,
          !response.ok
        );
        item.classList.remove('disabled');
      });
    });

    protocolsList.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async event => {
        event.stopPropagation();
        const idx = Number(btn.dataset.index);
        const list = await loadProtocols();
        const updated = removeFromList(list, idx);
        await saveProtocols(updated);
        renderProtocols(updated);
      });
    });
  }

  document.getElementById('btn-open-protocols').addEventListener('click', async () => {
    const list = await loadProtocols();
    renderProtocols(list);
    showView('protocols');
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    protocolsForm.classList.add('hidden');
    showView('actions');
  });

  function resetProtocolForm() {
    _autoProtocolData = null;
    caaeAutoEl.classList.add('hidden');
    caaeValueEl.textContent = '';
    inputNome.value = '';
  }

  document.getElementById('btn-show-add').addEventListener('click', async () => {
    caaeAutoEl.classList.add('hidden');
    protocolsForm.classList.remove('hidden');
    inputNome.focus();

    const res = await sendAction(tab.id, 'extractProtocolData');
    if (res.ok) {
      _autoProtocolData = { caae: res.caae, projectId: res.projectId };
      caaeValueEl.textContent = res.caae;
      caaeAutoEl.classList.remove('hidden');
    } else {
      _autoProtocolData = null;
      showFeedback(`Erro ao extrair dados: ${res.error}`, true);
    }
  });

  document.getElementById('btn-add-cancel').addEventListener('click', () => {
    protocolsForm.classList.add('hidden');
    resetProtocolForm();
  });

  inputNome.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-confirm').click();
  });

  document.getElementById('btn-add-confirm').addEventListener('click', async () => {
    const nome = inputNome.value.trim();
    const caae = _autoProtocolData?.caae ?? '';
    const projectId = _autoProtocolData?.projectId ?? null;
    if (!nome || !caae) {
      showFeedback('Preencha Nome e CAAE.', true);
      return;
    }
    let updated;
    try {
      const list = await loadProtocols();
      updated = addToList(list, nome, caae, projectId);
    } catch (e) {
      showFeedback(e.message, true);
      return;
    }
    await saveProtocols(updated);
    protocolsForm.classList.add('hidden');
    resetProtocolForm();
    renderProtocols(updated);
  });

  const btnSalvarEImprimir = document.getElementById('btn-salvar-e-imprimir');
  if (btnSalvarEImprimir) {
    if (!onPage) {
      btnSalvarEImprimir.disabled = true;
    } else {
      btnSalvarEImprimir.addEventListener('click', async () => {
        btnSalvarEImprimir.disabled = true;
        const result = await sendAction(tab.id, 'imprimir');
        showFeedback(
          result.ok ? 'Diálogo de impressão aberto.' : `Erro: ${result.error}`,
          !result.ok
        );
        btnSalvarEImprimir.disabled = false;
      });
    }
  }
});
