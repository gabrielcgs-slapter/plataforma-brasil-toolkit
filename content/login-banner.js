// Oculta #modalMsgContainer na página de login se preferência estiver ativa
(function () {
  chrome.storage.local.get('hideLoginBanner', function (result) {
    if (!result.hideLoginBanner) return;
    var style = document.createElement('style');
    style.id = 'pb-hide-login-banner';
    style.textContent = '#modalMsgContainer { display: none !important; }';
    document.documentElement.appendChild(style);
  });
})();
