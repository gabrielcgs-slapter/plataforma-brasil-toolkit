// background/service_worker.js

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'salvarPDF') return false;

  const tabId = message.tabId ?? sender.tab?.id;
  const { filename } = message;

  if (!tabId) { sendResponse({ ok: false, error: 'tabId não determinado' }); return true; }

  (async () => {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      const { data } = await chrome.debugger.sendCommand(
        { tabId },
        'Page.printToPDF',
        {
          landscape: false,
          printBackground: true,
          paperWidth: 8.27,   // A4 em polegadas
          paperHeight: 11.69,
          marginTop: 0.5,
          marginBottom: 0.5,
          marginLeft: 0.5,
          marginRight: 0.5,
          preferCSSPageSize: false,
        }
      );
      await chrome.debugger.detach({ tabId });
      await chrome.downloads.download({
        url: `data:application/pdf;base64,${data}`,
        filename: filename || 'plataforma_brasil.pdf',
        saveAs: false,
      });
      sendResponse({ ok: true });
    } catch (err) {
      try { await chrome.debugger.detach({ tabId }); } catch { /* já desconectado */ }
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // mantém canal aberto para resposta assíncrona
});
