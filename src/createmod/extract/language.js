// CJK-ratio language heuristic over a 20k-char sample (spec: >0.25 -> zh).
export function detectLang(text) {
  const sample = String(text).slice(0, 20000);
  let cjk = 0;
  let total = 0;
  for (const ch of sample) {
    if (/\s/.test(ch)) continue;
    total++;
    const c = ch.codePointAt(0);
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) cjk++;
  }
  return total > 0 && cjk / total > 0.25 ? 'zh' : 'en';
}
