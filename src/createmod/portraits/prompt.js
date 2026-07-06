// Create-Mod portraits — batching, grid geometry, prompt builder (pure).
// Spec: docs/superpowers/specs/2026-07-06-create-mod-portraits-design.md §3-4.

export const STYLE_MAX = 600;
export const BRIEF_MAX = 200;
export const PROMPT_MAX = 30000;
export const BATCH_MAX = 16;

export const DEFAULT_STYLE =
  'Retro Game-Boy-Color pixel-art style, chunky pixels, limited palette (~24 colors ' +
  'shared across all cells), dark simple backgrounds, bust framing (head and shoulders), ' +
  'consistent lighting and outline treatment across all cells.';

export function planBatches(n) {
  const k = Math.ceil(n / BATCH_MAX);
  const base = Math.floor(n / k);
  const rem = n % k;
  return Array.from({ length: k }, (_, i) => (i < rem ? base + 1 : base));
}

export function gridGeometry(n) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  // rows <= cols always (cols^2 >= n), so only two canvas cases exist
  const width = rows === cols ? 1024 : 1536;
  const height = 1024;
  return { cols, rows, width, height, size: `${width}x${height}` };
}

// First sentence, CJK-aware: cut after the first of 。！？!?.
export function firstSentence(text) {
  const s = String(text == null ? '' : text);
  const m = s.match(/^[^。！？!?.]*[。！？!?.]?/);
  return (m ? m[0] : '').trim();
}

function cellBrief(char, k, row, col, warnings) {
  const floor = `Cell ${k} (${row},${col}): ${char.name} — ${char.title || ''}`.trimEnd();
  const identity = char.identity ? `; ${char.identity}` : '';
  const appearance = char.background ? `; ${firstSentence(char.background)}` : '';
  let line = floor + identity + appearance;
  if (line.length > BRIEF_MAX) {
    line = line.length > floor.length
      ? (floor.length >= BRIEF_MAX ? floor : line.slice(0, BRIEF_MAX))
      : floor; // the floor itself is never truncated
    warnings.push(`brief truncated for ${char.id} (${BRIEF_MAX}-char cap)`);
  }
  return line;
}

export function buildGridPrompt(batch, opts) {
  const style = opts && opts.style ? opts.style : DEFAULT_STYLE;
  const warnings = [];
  const n = batch.length;
  if (n === 1) {
    const c = batch[0];
    const brief = cellBrief(c, 1, 1, 1, warnings).replace(/^Cell 1 \(1,1\): /, '');
    const prompt = `A single pixel-art character bust portrait, centered. ${style}\nCharacter: ${brief}`;
    return { prompt, warnings };
  }
  const { cols, rows } = gridGeometry(n);
  const lines = [];
  lines.push(
    `A single image containing a UNIFORM ${cols}x${rows} grid of ${n} pixel-art character ` +
    `bust portraits. Row-major order. One character per cell, centered, equal cell sizes, ` +
    `NO text, NO labels, NO borders between cells.` +
    (cols * rows > n ? ` Cells after the ${n}th must be plain dark background.` : '')
  );
  lines.push(style);
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / cols) + 1, col = (k % cols) + 1;
    lines.push(cellBrief(batch[k], k + 1, row, col, warnings));
  }
  const prompt = lines.join('\n');
  if (prompt.length > PROMPT_MAX) {
    // invariant guard: unreachable with STYLE_MAX + <=16 cells; REJECT loudly if it ever fires
    throw new Error(`prompt exceeds ${PROMPT_MAX} chars (${prompt.length}) — reduce --style or roster`);
  }
  return { prompt, warnings };
}
