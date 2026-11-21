/* A value typed next to a slider, read the way the slider would take it: a number (a "%" or
   spaces around it are fine, and a comma works as the decimal point; "off" is the lowest value),
   clamped to the slider's range and snapped to its step. null when it is not a number.
   Loaded by the page as a script and by the tests with require. */
(function (root) {
  function typedValue(text, min, max, step) {
    const raw = String(text == null ? '' : text).trim().replace(/%$/, '').trim().replace(',', '.');
    step = Number(step) > 0 ? Number(step) : 1;
    const n = /^off$/i.test(raw) ? min : raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(n)) return null;
    const places = (x) => (String(x).split('.')[1] || '').length;
    const decimals = Math.max(places(step), places(min));
    const snapped = min + Math.round((Math.min(max, Math.max(min, n)) - min) / step) * step;
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
  }
  const api = { typedValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenWValues = api;
}(typeof window !== 'undefined' ? window : globalThis));
