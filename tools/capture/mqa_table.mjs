// Mobile QA protocol before/after table (markdown) from two protocol_result.json files.
//   node tools/capture/mqa_table.mjs <before.json> <after.json> [label-before] [label-after] > table.md
import fs from 'node:fs';

const [bf, af, lb = 'before', la = 'after'] = process.argv.slice(2);
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const B = load(bf), A = load(af);
const by = (r) => new Map(r.rows.map((x) => [x.id, x]));
const mb = by(B), ma = by(A);
const ids = [...new Set([...B.rows.map((r) => r.id), ...A.rows.map((r) => r.id)])];
const fmt = (x) => (x == null ? '—' : `${String(x.value ?? '').slice(0, 60)} ${x.result === 'PASS' ? '✅' : x.result === 'FAIL' ? '❌' : x.result === 'NOTE' ? 'ℹ️' : '·'}`);
const cnt = (s) => Object.entries(s).map(([k, v]) => `${v} ${k}`).join(' / ');
console.log(`| check | threshold | ${lb} | ${la} |`);
console.log('|---|---|---|---|');
for (const id of ids) {
  const b = mb.get(id), a = ma.get(id), w = (a ?? b).what.replace(/\|/g, '/');
  console.log(`| ${w} | ${String((a ?? b).threshold).replace(/\|/g, '/')} | ${fmt(b)} | ${fmt(a)} |`);
}
console.log(`\n**${lb}:** ${cnt(B.summary)} · **${la}:** ${cnt(A.summary)}`);
