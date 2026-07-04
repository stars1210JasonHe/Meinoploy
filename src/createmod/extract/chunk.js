// Book chunker: walk forward chunkSize chars; inside a +/-15% window look BACKWARD for the
// last blank-line boundary, else the last single newline, else hard-split at exactly
// chunkSize. Invariants: every chunk non-empty and <= chunkSize*1.15 + overlap chars, so a
// bounded chunk can never exceed the model context.
export function chunkBook(text, opts = {}) {
  const chunkSize = opts.chunkSize !== undefined ? opts.chunkSize : 12000;
  const overlap = opts.overlap !== undefined ? opts.overlap : 400;
  const maxChunks = opts.maxChunks !== undefined ? opts.maxChunks : 200;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(`chunkSize must be a positive integer (got ${chunkSize})`);
  }
  const norm = String(text).replace(/\r\n?/g, '\n');
  const chunks = [];
  let pos = 0;
  let prevTail = '';
  while (pos < norm.length) {
    let end = Math.min(pos + chunkSize, norm.length);
    if (end < norm.length) {
      const winStart = pos + Math.floor(chunkSize * 0.85);
      const winEnd = Math.min(pos + Math.ceil(chunkSize * 1.15), norm.length);
      const win = norm.slice(winStart, winEnd);
      let cut = -1;
      const blank = win.match(/\n\s*\n(?![\s\S]*\n\s*\n)/); // last blank-line boundary in window
      if (blank) cut = winStart + blank.index;
      else {
        const nl = win.lastIndexOf('\n');
        if (nl >= 0) cut = winStart + nl;
      }
      if (cut > pos) end = cut;
    }
    const body = norm.slice(pos, end);
    if (body.trim().length > 0) {
      chunks.push({ index: chunks.length, text: prevTail + body });
      if (chunks.length > maxChunks) {
        throw new Error(`book too large: more than ${maxChunks} chunks; raise --max-chunks`);
      }
      prevTail = overlap > 0 ? body.slice(-overlap) : '';
    }
    pos = end > pos ? end : pos + chunkSize; // guaranteed progress
  }
  return chunks;
}
