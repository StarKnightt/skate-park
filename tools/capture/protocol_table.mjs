// Markdown before/after table of two mobile-QA protocol results (E:/shots/skate-park/mobile-qa/tools/protocol.mjs output).
//   node tools/capture/protocol_table.mjs <before protocol_result.json> <after protocol_result.json> [after2.json]
import fs from 'node:fs';

const files = process.argv.slice(2);
const runs = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const ids = [];
for (const r of runs) for (const row of r.rows) if (!ids.includes(row.id)) ids.push(row.id);
const fmt = (row) => {
  if (!row) return '—';
  let v = row.value;
  if (typeof v === 'number') v = Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(2);
  v = String(v ?? '').replace(/\|/g, '/').slice(0, 60);
  return `${row.result === 'PASS' ? '✅' : row.result === 'FAIL' ? '❌' : row.result} ${v}`;
};
const head = ['check', 'threshold', ...files.map((_, i) => (i === 0 ? 'before' : files.length > 2 ? `after ${i}` : 'after'))];
console.log(`| ${head.join(' | ')} |`);
console.log(`|${head.map(() => '---').join('|')}|`);
for (const id of ids) {
  const rows = runs.map((r) => r.rows.find((x) => x.id === id));
  const any = rows.find(Boolean);
  console.log(`| ${any.what.replace(/\|/g, '/')} | ${String(any.threshold).replace(/\|/g, '/')} | ${rows.map(fmt).join(' | ')} |`);
}
console.log('');
console.log(runs.map((r, i) => `${head[2 + i]}: ${Object.entries(r.summary).map(([k, n]) => `${n} ${k}`).join(' / ')} (${r.when})`).join('  \n'));
