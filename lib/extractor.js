// lib/extractor.js

function getTextAfterLabel(doc, labelText) {
  const spans = doc.querySelectorAll('span.labelClass');
  for (const span of spans) {
    if (span.textContent.includes(labelText)) {
      const td = span.closest('td');
      if (!td) continue;
      const label = span.textContent.trim();
      const full = td.textContent.trim();
      const value = full.includes(label) ? full.replace(label, '').trim() : full.trim();
      if (value) return value;
      // HTML malformado (Área Temática, Patrocinador): valor está em td irmão
      // Patrocinador tem td vazio extra — percorre até achar conteúdo
      let next = td.nextElementSibling;
      while (next) {
        const v = next.textContent.trim();
        if (v) return v;
        next = next.nextElementSibling;
      }
      return null;
    }
  }
  return null;
}

const TIPO_CENTRO_MAP = {
  CARIMBO_COORDENADOR:    'Coordenador',
  CARIMBO_PARTICIPANTE:   'Participante',
  CARIMBO_COPARTICIPANTE: 'Coparticipante',
};

function extractTipoCentro(doc) {
  const img = doc.querySelector('img[src*="CARIMBO"]');
  if (!img) return null;
  const filename = img.src.split('/').pop().replace('.png', '');
  return TIPO_CENTRO_MAP[filename] ?? null;
}

function extractProjectId(doc) {
  for (const el of doc.querySelectorAll('[onclick]')) {
    const m = el.getAttribute('onclick').match(/'coProjeto'\s*:\s*(\d+)/);
    if (m) return m[1];
  }
  for (const s of doc.querySelectorAll('script')) {
    const m = s.textContent.match(/'coProjeto'\s*:\s*(\d+)/);
    if (m) return m[1];
  }
  for (const td of doc.querySelectorAll('td')) {
    const m = td.textContent.trim().match(/^PB_COMPROVANTE_RECEPCAO_(\d+)$/);
    if (m) return m[1];
  }
  return null;
}

function extractEmendaAtual(doc) {
  const nodes = doc.querySelectorAll('.rich-tree-node-text');
  for (const td of nodes) {
    if (td.textContent.includes('Versão Atual Aprovada')) {
      const match = td.textContent.match(/\(([^)]+)\)/);
      return match ? match[1].trim() : null;
    }
  }
  return null;
}

function extractProjectData(doc) {
  return {
    caae:          getTextAfterLabel(doc, 'CAAE:'),
    titulo:        getTextAfterLabel(doc, 'Título da Pesquisa:'),
    pesquisador:   getTextAfterLabel(doc, 'Pesquisador Responsável:'),
    situacao:      getTextAfterLabel(doc, 'Situação da Versão do Projeto:'),
    instituicao:   getTextAfterLabel(doc, 'Instituição Proponente:'),
    areaTematica:  getTextAfterLabel(doc, 'Área Temática:'),
    patrocinador:  getTextAfterLabel(doc, 'Patrocinador Principal:'),
    emendaAtual:   extractEmendaAtual(doc),
    tipoCentro:    extractTipoCentro(doc),
    projectId:     extractProjectId(doc),
  };
}

const TRAMITES_TABLE_SEL = '#formDetalharProjeto\\:tabelaApreciacoesProjetos';

function extractTramites(doc) {
  const table = doc.querySelector(TRAMITES_TABLE_SEL);
  if (!table) return [];

  const headers = [...table.querySelectorAll('thead th')].map(th =>
    th.textContent.trim().replace(/\s+/g, ' ')
  );

  const rows = [...table.querySelectorAll('tbody tr')];
  return rows.map(tr => {
    const cells = [...tr.querySelectorAll('td')].map(td =>
      td.textContent.trim().replace(/\s+/g, ' ')
    );
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    return obj;
  });
}

function buildCsv(rows) {
  if (!rows.length) return '﻿';
  const headers = Object.keys(rows[0]);
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escape).join(';'),
    ...rows.map(r => headers.map(h => escape(r[h])).join(';')),
  ];
  return '﻿' + lines.join('\r\n');
}

// Exporta para Node.js (Jest) e também funciona no browser (content script)
if (typeof module !== 'undefined') {
  module.exports = { extractProjectData, extractProjectId, extractTramites, buildCsv };
}
