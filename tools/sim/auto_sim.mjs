// Headless auto-ride check: the autopilot rides the real park collision with the real physics.
// node tools/sim/build_src.mjs tools/sim/.build-e2 && node tools/sim/auto_sim.mjs [--laps 3] [--seeds 1,2,3] [--attract] [--trace] [--secs 400]
globalThis.location = { search: '' };
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes('--' + k);
const B = arg('build', './.build-e2');
const { Vector3 } = await import('three');
const { buildPark } = await import(`${B}/world/park.js`);
const { CollisionWorld } = await import(`${B}/world/collision.js`);
const { SkatePhysics } = await import(`${B}/player/physics.js`);
const { Autopilot } = await import(`${B}/player/autopilot.js`);

const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120;
const laps = +arg('laps', 3), secs = +arg('secs', 420);
const seeds = String(arg('seeds', '1,2,3')).split(',').map(Number);
const trace = flag('trace'), attract = flag('attract'), every = +arg('every', 0.25);
const traceFrom = +arg('from', 0), traceTo = +arg('to', 1e9);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const all = [];
for (const seed of seeds) {
  Math.random = mulberry(seed * 7919 + 1);
  const ph = new SkatePhysics(world);
  if (ph.assist) Object.assign(ph.assist, { landing: true, autoGrind: true, fastRecover: true });
  if (flag('pro') && ph.assist) Object.assign(ph.assist, { landing: false, autoGrind: false, fastRecover: false });
  ph.reset(park.spawn.pos.clone(), park.spawn.heading);
  const ap = new Autopilot(ph, { seed, attract });
  let t = 0, lap = 0, lapT0 = 0, slow = 0, nextLog = 0;
  const mk = () => ({ bails: [], cov: new Set(), stuck: 0, out: 0, dist: 0, tricks: 0, flips: 0, grinds: [], manuals: 0, kicks: 0, airs: 0, wobbles: 0, t: 0 });
  let cur = mk();
  const lapsOut = [];
  const prevPos = ph.pos.clone();
  let prevLine = '';
  while (t < secs && lap <= laps) {
    ph.events.length = 0;
    const inp = ap.sample(STEP, ph.mode === 'air');
    ph.step(STEP, inp);
    t += STEP;
    // headless recovery: stand back on the board where it came to rest
    if (ph.mode === 'bail' && ph.bail && ph.bail.t > 2.0 && (ph.bail.board.asleep || ph.bail.t > 6)) {
      const p = new Vector3(), f = new Vector3(), u = new Vector3();
      ph.bail.board.ridePose(p, f, u);
      ph.finishRecover(p, f);
    }
    const f = ap.feature;
    for (const e of ph.events) {
      if (e.type === 'bail') cur.bails.push(`${t.toFixed(1)}s ${e.kind}/${e.reason} @${ph.pos.x.toFixed(1)},${ph.pos.z.toFixed(1)} [${ap.lineName}]`);
      if (e.type === 'grindStart') { cur.grinds.push(e.name); cur.cov.add(e.kind === 'rail' ? 'rail' : e.kind === 'ledge' ? 'ledge' : 'coping'); cur.tricks++; }
      if (e.type === 'manualStart') { cur.manuals++; cur.cov.add('manual'); cur.tricks++; }
      if (e.type === 'kickturn') { cur.kicks++; cur.tricks++; if (f === 'qp') cur.cov.add('qp'); if (f === 'halfpipe') cur.cov.add('halfpipe'); }
      if (e.type === 'vertAir') { cur.airs++; cur.tricks++; if (f === 'qp') cur.cov.add('qp'); if (f === 'halfpipe') cur.cov.add('halfpipe'); if (f === 'bowl') cur.cov.add('bowl'); }
      if (e.type === 'pop') { if (e.flip) { cur.flips++; } cur.tricks++; if (f === 'funbox') cur.cov.add('funbox'); }
      if (e.type === 'land' && e.quality === 'wobble') cur.wobbles++;
      if (e.type === 'dropIn' && f === 'bowl') cur.cov.add('bowl');
    }
    if (ph.mode === 'ride' && ph.up.y < 0.75) { if (f === 'halfpipe') cur.cov.add('halfpipe'); if (f === 'qp') cur.cov.add('qp'); if (f === 'bowl') cur.cov.add('bowl'); }
    cur.dist += ph.pos.distanceTo(prevPos); prevPos.copy(ph.pos);
    if (ph.mode === 'ride' && ph.speed < 0.3 && ph.kickturn.t < 0) { slow += STEP; if (slow > 3 && slow - STEP <= 3) cur.stuck++; } else slow = 0;
    if (Math.abs(ph.pos.x) > 39.3 || ph.pos.z < -27.6 || ph.pos.z > 26.4 || ph.pos.y < -3 || ph.pos.y > 8) cur.out++;
    if (cur.grinds.length > 60) { cur.bails.push(`${t.toFixed(1)}s GRIND LOOP @${ph.pos.x.toFixed(1)},${ph.pos.z.toFixed(1)} [${ap.lineName}]`); break; }
    if (trace && t >= nextLog && t >= traceFrom && t <= traceTo) {
      nextLog = t + every;
      const ln = ap.lineName;
      console.log(`${t.toFixed(2)} ${ph.mode.padEnd(5)} ${ph.pos.x.toFixed(2)},${ph.pos.y.toFixed(2)},${ph.pos.z.toFixed(2)} v${ph.speed.toFixed(2)} upY${ph.up.y.toFixed(2)} seg${ap.seg} s${ap.s.toFixed(1)} ${ap.state} st${inp.steer.toFixed(2)}${inp.push ? ' P' : ''}${inp.brake ? ' B' : ''}${inp.crouch ? ' C' : ''}${inp.ollie ? ' OLLIE' : ''}${inp.manual ? ' M' : ''}${inp.grind ? ' G' : ''} ${ln !== prevLine ? '<' + ln + '>' : ''} ${ph.events.map((e) => e.type + (e.quality ? ':' + e.quality : '') + (e.name ? '[' + e.name + ']' : '') + (e.reason ? '{' + e.reason + '}' : '')).join(' ')}`);
      prevLine = ln;
    } else if (trace && ph.events.length && t >= traceFrom && t <= traceTo) {
      console.log(`${t.toFixed(2)}   ${ph.mode} ${ph.pos.x.toFixed(2)},${ph.pos.y.toFixed(2)},${ph.pos.z.toFixed(2)} v${ph.speed.toFixed(2)} ${ph.events.map((e) => e.type + (e.quality ? ':' + e.quality : '') + (e.name ? '[' + e.name + ']' : '') + (e.reason ? '{' + e.reason + '}' : '') + (e.flip ? '(' + (e.flip.name ?? e.flip) + ')' : '')).join(' ')}`);
    }
    if (ap.lap > lap) {
      // the first wrap ends the partial lap from the spawn point: measure whole laps only
      cur.t = t - lapT0;
      if (lap > 0) lapsOut.push(cur);
      lap = ap.lap; lapT0 = t; cur = mk();
    }
  }
  if (lap <= laps) { cur.t = t - lapT0; cur.unfinished = true; lapsOut.push(cur); }
  for (const [i, l] of lapsOut.entries()) {
    const line = `seed ${seed} lap ${i + 1}${l.unfinished ? ' (UNFINISHED at ' + ap.lineName + ')' : ''}: ${l.t.toFixed(1)} s, ${l.dist.toFixed(0)} m, avg ${(l.dist / Math.max(1, l.t)).toFixed(2)} m/s, bails ${l.bails.length}, stuck ${l.stuck}, out ${l.out}, tricks ${l.tricks} (flips ${l.flips}, grinds ${l.grinds.length}, manuals ${l.manuals}, kickturns ${l.kicks}, airs ${l.airs}), wobbles ${l.wobbles}, cov [${[...l.cov].sort().join(',')}]`;
    console.log(line);
    for (const b of l.bails) console.log('    bail ' + b);
    if (flag('grinds')) console.log('    grinds: ' + l.grinds.slice(0, 12).join(', '));
    all.push({ seed, ...l });
  }
}
const done = all.filter((l) => !l.unfinished);
const clean = done.filter((l) => l.bails.length === 0 && l.stuck === 0 && l.out === 0);
console.log(`\nSUMMARY: ${done.length} laps finished, ${clean.length} clean (${((clean.length / Math.max(1, done.length)) * 100).toFixed(0)}%), unfinished ${all.length - done.length}, avg lap ${(done.reduce((a, l) => a + l.t, 0) / Math.max(1, done.length)).toFixed(1)} s, tricks/lap ${(done.reduce((a, l) => a + l.tricks, 0) / Math.max(1, done.length)).toFixed(1)}`);
