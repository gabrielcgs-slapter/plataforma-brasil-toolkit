// content/attribute-config.js
async function applyAttributeConfig(rulesUrl, doc, trigger) {
  let rules;
  try {
    const res = await fetch(rulesUrl);
    rules = await res.json();
  } catch (e) {
    console.warn('[pb-toolkit] attributes.json:', e.message);
    return;
  }
  const target = doc ?? document;
  const filtered = trigger ? rules.filter(r => r.trigger === trigger) : rules;
  filtered.forEach(({ selector, attributes }) => {
    target.querySelectorAll(selector).forEach(el => {
      Object.entries(attributes).forEach(([attr, val]) => {
        if (/^on/i.test(attr) || attr.toLowerCase() === 'style') return;
        el.setAttribute(attr, val);
      });
    });
  });
}

if (typeof module !== 'undefined') module.exports = { applyAttributeConfig };
