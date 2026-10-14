// Layout audit per device profile x orientation (emulated safe-area insets): tap-target sizes, font sizes, overlaps between
// the HUD / touch controls / trick popup / skater, safe-area clearance, pause menu + controls page + help panel fit and
// touch scrolling. Screenshots: gameplay, mid-trick, trick popup, pause menu, controls page (+ help on phones).
// bash tools/heavy.sh mobileqa node tools/mobile-qa/layout.mjs [--configs iphone:P,iphone:L,...]
import path from 'node:path';
import { launch, mobilePage, PROFILES, BASE_URL, Touch, sleep, center, waitReady, bundleName, save, log, SHOTS, opt } from './common.mjs';

const configs = opt('configs', 'iphone:P,iphone:L,android:P,android:L,small:P,small:L,ipad:P,ipad:L,iphoneSafari:P,iphoneSafari:L,androidChrome:P,androidChrome:L').split(',');
const browser = await launch();
const out = { bundle: null, configs: [] };

/** page-side: rects of every HUD / control element that is visible, plus the skater's screen box */
const collect = () => {
  const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const items = {};
  const add = (name, e, interactive, opacityNote) => { if (vis(e)) items[name] = { ...R(e), interactive, font: parseFloat(getComputedStyle(e).fontSize), opacity: +getComputedStyle(e).opacity, ...(opacityNote ? { note: opacityNote } : {}) }; };
  add('stick', document.querySelector('.stick'), true);
  for (const [n, s] of [['OLLIE', '.tbtn.ollie'], ['TRICK', '.tbtn.flipbtn'], ['AUTO', '.tbtn.autobtn'], ['GRIND', '.tbtn.grind'], ['MANUAL', '.tbtn.manual']]) add(n, document.querySelector(s), true);
  add('pauseBtn', document.querySelector('.pausebtn'), true);
  document.querySelectorAll('.topbar .pill').forEach((p, i) => add('pill_' + (p.classList.contains('tod') ? 'timeOfDay' : p.classList.contains('snd') ? 'sound' : p.classList.contains('hlp') ? 'help' : p.classList.contains('menu') ? 'menu' : i), p, true));
  add('topbar', document.querySelector('.topbar'), false);
  add('hint', document.querySelector('.hint'), false);
  add('modeLabel', document.querySelector('.modelabel'), false);
  add('trickName', document.querySelector('.trick .name'), false);
  add('trickCombo', document.querySelector('.trick .combo'), false);
  add('toast', document.querySelector('.toast'), false);
  add('swipeHint', document.querySelector('.swipehint'), false);
  // skater (+ board) screen box from the 3D bounds
  const s = window.__skate, g = s.game, cam = g.camera;
  const B = new (g.skater.root.position.constructor)(); // Vector3
  const box = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
  const W = innerWidth, H = innerHeight;
  const pts = [];
  const tmp = new (g.skater.root.position.constructor)();
  for (const root of [g.skater.root, g.board.root]) root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    for (let i = 0; i < 8; i++) { tmp.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld); pts.push(tmp.clone()); }
  });
  // skinned meshes: geometry bounds are in bind pose; use the bones instead (hips/head/feet/hands)
  const bones = ['Hips', 'Head', 'HeadTop_End', 'LeftFoot', 'RightFoot', 'LeftHand', 'RightHand', 'LeftToeBase', 'RightToeBase', 'Spine2'];
  const bpts = [];
  for (const n of bones) { const b = g.skater.b?.get?.(n)?.bone; if (b) bpts.push(b.getWorldPosition(tmp.clone())); }
  const use = bpts.length >= 4 ? bpts.concat([g.board.root.position.clone()]) : pts;
  for (const p of use) { const v = p.clone().project(cam); const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H; box.min[0] = Math.min(box.min[0], x); box.min[1] = Math.min(box.min[1], y); box.max[0] = Math.max(box.max[0], x); box.max[1] = Math.max(box.max[1], y); }
  // pad: bones are joint centres (add ~ head radius / body width)
  const padX = (box.max[1] - box.min[1]) * 0.12, padY = (box.max[1] - box.min[1]) * 0.08;
  items.skater = { l: +(box.min[0] - padX).toFixed(1), t: +(box.min[1] - padY).toFixed(1), r: +(box.max[0] + padX).toFixed(1), b: +(box.max[1] + padY).toFixed(1), interactive: false };
  items.skater.w = +(items.skater.r - items.skater.l).toFixed(1); items.skater.h = +(items.skater.b - items.skater.t).toFixed(1);
  const insets = (() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'; document.body.appendChild(d); const cs = getComputedStyle(d); const o = { top: parseFloat(cs.paddingTop), right: parseFloat(cs.paddingRight), bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft) }; d.remove(); return o; })();
  return { W, H, insets, items, canvas: [g.renderer.domElement.width, g.renderer.domElement.height], fov: +cam.fov.toFixed(1), hfov: +(2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect) * 180 / Math.PI).toFixed(1) };
};

function analyse(L) {
  const it = L.items, names = Object.keys(it);
  const small = names.filter((n) => it[n].interactive && (it[n].w < 44 || it[n].h < 44)).map((n) => `${n} ${it[n].w}x${it[n].h}`);
  const fonts = names.filter((n) => it[n].font && it[n].font < 12 && !['stick', 'topbar', 'skater'].includes(n)).map((n) => `${n} ${it[n].font}px`);
  const inter = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const overlaps = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    if (a === 'topbar' && b.startsWith('pill_') || b === 'topbar' && a.startsWith('pill_')) continue;
    if ([a, b].includes('trickCombo') && [a, b].includes('trickName')) continue;
    const ar = inter(it[a], it[b]);
    if (ar > 4) overlaps.push(`${a} x ${b} (${Math.round(ar)} px²)`);
  }
  // thumbs: a 45 px pad around the stick and the right-hand buttons (the thumb and finger sit on and around them)
  const thumbs = [];
  for (const n of ['stick', 'OLLIE', 'TRICK', 'AUTO', 'GRIND', 'MANUAL']) if (it[n] && it.skater) {
    const p = 45, z = { l: it[n].l - p, t: it[n].t - p, r: it[n].r + p, b: it[n].b + p };
    const ar = inter(z, it.skater); if (ar > 0) thumbs.push(`${n} (+45px) covers ${Math.round(ar / (it.skater.w * it.skater.h) * 100)}% of the skater box`);
  }
  const ins = L.insets, safe = [];
  for (const n of names) {
    const r = it[n]; if (n === 'skater' || n === 'topbar') continue;
    if (r.t < ins.top - 0.5) safe.push(`${n} top ${r.t} < inset ${ins.top}`);
    if (r.l < ins.left - 0.5) safe.push(`${n} left ${r.l} < inset ${ins.left}`);
    if (L.W - r.r < ins.right - 0.5) safe.push(`${n} right gap ${+(L.W - r.r).toFixed(1)} < inset ${ins.right}`);
    if (L.H - r.b < ins.bottom - 0.5) safe.push(`${n} bottom gap ${+(L.H - r.b).toFixed(1)} < inset ${ins.bottom}`);
  }
  return { smallTargets: small, smallFonts: fonts, overlaps, thumbsOnSkater: thumbs, safeArea: safe };
}

for (const cfg of configs) {
  const [pk, o] = cfg.split(':');
  const prof = PROFILES[pk], landscape = o === 'L', tag = `${pk}_${landscape ? 'land' : 'port'}`;
  const m = await mobilePage(browser, prof, { landscape });
  const { page, cdp, vp } = m;
  await page.goto(BASE_URL + '?test&touch&mute&mode=easy', { waitUntil: 'load', timeout: 120000 });
  await waitReady(page, true);
  out.bundle ??= await bundleName(page);
  const touch = new Touch(cdp);
  const res = { config: cfg, profile: prof.name, viewport: vp };
  await page.evaluate(() => { const s = window.__skate, g = s.game, p = g.spawn.pos; s.teleport(p.x, p.y, p.z, g.spawn.heading * 180 / Math.PI, 3.8); });
  await sleep(1600);
  // 1. gameplay (hint + mode label still up: the first seconds a new player sees)
  res.start = collect && await page.evaluate(collect);
  res.startIssues = analyse(res.start);
  await page.screenshot({ path: path.join(SHOTS, `layout_${tag}_1_gameplay.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  // 2. mid-trick (TRICK tap) then 3. the trick popup after landing
  const tr = await center(page, '.tbtn.flipbtn');
  if (tr) {
    await touch.tap(tr.x, tr.y, 60); await sleep(230);
    await page.screenshot({ path: path.join(SHOTS, `layout_${tag}_2_midtrick.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
    await sleep(520);
    res.popup = await page.evaluate(collect);
    res.popupIssues = analyse(res.popup);
    await page.screenshot({ path: path.join(SHOTS, `layout_${tag}_3_trickpopup.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  }
  await sleep(6000); // hint fades (6 s): the steady HUD
  res.steady = await page.evaluate(collect);
  res.steadyIssues = analyse(res.steady);
  // 4. pause menu by touch
  const pb = await center(page, '.pausebtn');
  await touch.tap(pb.x, pb.y, 60); await sleep(500);
  const menu = () => page.evaluate(() => {
    const el = document.querySelector('.pause'), p = el.querySelector('.panel');
    const btns = [...el.querySelectorAll('.pg.on button, .pg.on input')].filter((b) => b.offsetParent !== null).map((b) => { const r = b.getBoundingClientRect(); return { label: (b.innerText || b.dataset.v || b.dataset.key || b.type || '').trim().replace(/\s+/g, ' ').slice(0, 18), w: +r.width.toFixed(1), h: +r.height.toFixed(1), visible: r.top >= p.getBoundingClientRect().top - 1 && r.bottom <= p.getBoundingClientRect().bottom + 1 }; });
    const pr = p.getBoundingClientRect();
    const fonts = [...el.querySelectorAll('.pg.on .lab, .pg.on .desc, .pg.on .seg button, .pg.on .btn, .pg.on td, .pg.on .note, .pg.on .val')].filter((x) => x.offsetParent !== null).map((x) => parseFloat(getComputedStyle(x).fontSize));
    return { open: el.classList.contains('show'), panel: { l: pr.left, t: pr.top, w: pr.width, h: pr.height, clientH: p.clientHeight, scrollH: p.scrollHeight, needsScroll: p.scrollHeight > p.clientHeight + 1 },
      small: btns.filter((b) => b.h < 44 || b.w < 44).map((b) => `${b.label} ${b.w}x${b.h}`), hidden: btns.filter((b) => !b.visible).map((b) => b.label), count: btns.length,
      minFont: Math.min(...fonts), fonts: [...new Set(fonts)].sort((a, b) => a - b), viewport: [innerWidth, innerHeight] };
  });
  res.pause = await menu();
  await page.screenshot({ path: path.join(SHOTS, `layout_${tag}_4_pause.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
  // touch-scroll the panel (if it overflows) to reach the bottom
  if (res.pause.panel.needsScroll) {
    const p = res.pause.panel;
    const id = await touch.down(p.l + p.w / 2, p.t + p.h * 0.8); await touch.glide(id, p.l + p.w / 2, p.t + p.h * 0.2, 250, 8); await touch.up(id); await sleep(400);
    res.pause.scrolledTo = await page.evaluate(() => document.querySelector('.pause .panel').scrollTop);
  }
  // 5. controls page
  const cb = await center(page, '.pause [data-act="controls"]');
  if (cb) { await touch.tap(cb.x, cb.y, 60); await sleep(400); res.controls = await menu(); await page.screenshot({ path: path.join(SHOTS, `layout_${tag}_5_controls.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
    if (res.controls.panel.needsScroll) { const p = res.controls.panel; const id = await touch.down(p.l + p.w / 2, p.t + p.h * 0.8); await touch.glide(id, p.l + p.w / 2, p.t + p.h * 0.15, 250, 8); await touch.up(id); await sleep(400); res.controls.scrolledTo = await page.evaluate(() => document.querySelector('.pause .panel').scrollTop); }
    const back = await center(page, '.pause [data-act="back"]'); if (back) { await touch.tap(back.x, back.y, 60); await sleep(300); } }
  const rs = await center(page, '.pause [data-act="resume"]'); if (rs) { await touch.tap(rs.x, rs.y, 60); await sleep(400); }
  res.resumed = await page.evaluate(() => !window.__skate.game.paused);
  // 6. help panel (the "?" pill) on phones
  const hp = await center(page, '.topbar .hlp');
  if (hp) {
    await touch.tap(hp.x, hp.y, 60); await sleep(400);
    res.help = await page.evaluate(() => { const h = document.querySelector('.help'), r = h.getBoundingClientRect(), c = h.querySelector('.close').getBoundingClientRect(); return { open: h.classList.contains('show'), w: r.width, h: r.height, needsScroll: h.scrollHeight > h.clientHeight + 1, close: [+c.width.toFixed(1), +c.height.toFixed(1)], font: parseFloat(getComputedStyle(h).fontSize) }; });
    if (!landscape && pk !== 'ipad') await page.screenshot({ path: path.join(SHOTS, `layout_${tag}_6_help.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
    const cl = await center(page, '.help .close'); if (cl) { await touch.tap(cl.x, cl.y, 60); await sleep(300); }
    res.helpClosed = await page.evaluate(() => !document.querySelector('.help').classList.contains('show'));
  }
  out.configs.push(res);
  const iss = res.steadyIssues;
  log(cfg.padEnd(16), `${vp.width}x${vp.height}`, 'insets', JSON.stringify(res.start.insets), 'canvas', res.start.canvas.join('x'), 'hfov', res.start.hfov,
    '| small:', iss.smallTargets.join('; '), '| overlaps:', [...new Set([...res.startIssues.overlaps, ...(res.popupIssues?.overlaps ?? []), ...iss.overlaps])].join('; '),
    '| thumbs:', iss.thumbsOnSkater.join('; '), '| safe:', [...new Set([...res.startIssues.safeArea, ...iss.safeArea])].join('; '),
    '| pause:', JSON.stringify({ scroll: res.pause.panel.needsScroll, scrolledTo: res.pause.scrolledTo, h: res.pause.panel.h, minFont: res.pause.minFont, small: res.pause.small.length, hidden: res.pause.hidden.length }),
    '| controls:', JSON.stringify({ scroll: res.controls?.panel.needsScroll, scrolledTo: res.controls?.scrolledTo }), '| help:', JSON.stringify(res.help));
  await m.context.close();
}
save('layout.json', out);
await browser.close();
