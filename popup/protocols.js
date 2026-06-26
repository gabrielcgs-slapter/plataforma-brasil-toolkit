// popup/protocols.js
/* eslint-disable no-unused-vars -- funções consumidas via <script> tag por popup.js */
const PROTOCOLS_KEY = 'pb_protocols';

const CAAE_REGEX = /^\d{8}\.\d\.\d{4}\.\d{4}$/;

function isValidCAAE(caae) {
  return CAAE_REGEX.test(caae);
}

function addToList(list, nome, caae, projectId = null) {
  const trimmedCAAE = caae.trim();
  if (!isValidCAAE(trimmedCAAE)) {
    throw new Error(`CAAE inválido: "${trimmedCAAE}". Formato esperado: 00000000.0.0000.0000`);
  }
  const entry = { nome: nome.trim(), caae: trimmedCAAE };
  if (projectId) entry.projectId = String(projectId);
  return [...list, entry];
}

function removeFromList(list, index) {
  return list.filter((_, i) => i !== index);
}

async function loadProtocols() {
  const result = await chrome.storage.local.get(PROTOCOLS_KEY);
  return result[PROTOCOLS_KEY] ?? [];
}

async function saveProtocols(list) {
  await chrome.storage.local.set({ [PROTOCOLS_KEY]: list });
}
