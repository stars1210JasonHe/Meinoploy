// Create-Mod balance report renderer (spec §1/§2): printed by the CLI and
// persisted to mods/<id>/balance-report.md — the persist-for-later pattern the
// backgrounds/*.prompt.txt files established.

function pct(x) { return (x * 100).toFixed(1) + '%'; }

function meleeTable(melee) {
  const lines = [];
  lines.push(`seats=${melee.seats}  games=${melee.games}  baseline=${pct(1 / melee.seats)}`);
  lines.push('');
  lines.push('| character | played | wins | win% | 95% CI | flag |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of melee.rows) {
    lines.push(`| ${r.charId} | ${r.games} | ${r.wins} | ${pct(r.winPct)} | [${pct(r.ciLow)}, ${pct(r.ciHigh)}] | ${r.flag ? r.flag.toUpperCase() : ''} |`);
  }
  return lines.join('\n');
}

export function renderBalanceReport(ctx) {
  const lines = [];
  lines.push(`# Balance report — ${ctx.modId}`);
  lines.push('');
  lines.push(`date: ${ctx.date}  seed: ${ctx.seed}  games: ${ctx.games}`);
  lines.push('');
  lines.push('## Melee — full roster, per-character win rates');
  lines.push('');
  lines.push(meleeTable(ctx.melee));
  lines.push('');
  if (ctx.gate) {
    lines.push('## 1v1 fit gate (60/40)');
    lines.push('');
    lines.push(`${ctx.gate.pass ? 'PASS' : 'FAIL'} — leader ${ctx.gate.leader} ${pct(ctx.gate.maxWinPct)} (threshold ${pct(ctx.gate.threshold)})`);
    lines.push('');
  }
  if (ctx.autoBalance && ctx.autoBalance.ran) {
    const ab = ctx.autoBalance;
    lines.push('## Auto-balance');
    lines.push('');
    if (ab.appliedMoves.length) {
      lines.push('Applied moves (1 stat point each, identity stat locked):');
      lines.push('');
      for (const m of ab.appliedMoves) {
        lines.push(`- ${m.charId}: ${m.from} → ${m.to} (spread Δ ${m.delta >= 0 ? '+' : ''}${(m.delta * 100).toFixed(2)}pp, flags ${m.flagsBefore}→${m.flagsAfter})`);
      }
      lines.push('');
    }
    lines.push(`evaluations: ${ab.evals}`);
    lines.push('');
    if (ab.flagsCleared) {
      lines.push('Result: all balance flags cleared. ✔');
    } else {
      lines.push('Result: the optimizer did NOT fully clear the flags' +
        (ab.stalled ? ' (stalled — no single-point stat move improved the measured balance)' : '') +
        (ab.cappedByEvals ? ' (evaluation budget cap reached)' : '') +
        (ab.cappedByIterations ? ' (iteration cap reached)' : '') + '.');
      lines.push('');
      lines.push('Remaining imbalance is likely structural (passives, start-money snowball, map');
      lines.push('shape). Next lever: a mod-level rules-override (see mods/sanguo-excerpt/');
      lines.push('bundle.data.js — the SANGUO_RULES deepClone pattern) or hand-editing the');
      lines.push('character identity stats this optimizer deliberately never touches.');
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}
