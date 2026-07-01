// content/attribute-config.js
let _cachedRules = null;

async function applyAttributeConfig(rulesUrl, doc, trigger) {
  if (!_cachedRules) {
    try {
      const res = await fetch(rulesUrl);
      _cachedRules = await res.json();
    } catch (e) {
      console.warn('[pb-toolkit] attributes.json:', e.message);
      return;
    }
  }
  const target = doc ?? document;
  const filtered = trigger ? _cachedRules.filter(r => r.trigger === trigger) : _cachedRules;
  filtered.forEach(({ selector, attributes }) => {
    target.querySelectorAll(selector).forEach(el => {
      Object.entries(attributes).forEach(([attr, val]) => {
        if (/^on/i.test(attr) || attr.toLowerCase() === 'style') return;
        el.setAttribute(attr, val);
      });
    });
  });
}

function clearRulesCache() { _cachedRules = null; }

if (typeof module !== 'undefined') module.exports = { applyAttributeConfig, clearRulesCache };
