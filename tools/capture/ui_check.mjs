// Pass-4 UI checks (helper C): pause menu, HUD hints, mode label, mouse-lock pill, title card, touch layouts, audio duck.
// bash tools/heavy.sh C node tools/capture/run.mjs tools/capture/ui_check.mjs --nohmr --out E:/shots/skate-park/pass-04/ui --url http://127.0.0.1:5188/ --q "test&mute&mode=easy"
//   phone: --mobile --w 390 --h 844 --q "test&mute&touch&mode=easy"  (landscape --w 844 --h 390) · Pro: mode=pro
//   without &mute the audio graph is checked too (duck, volumes); Chrome runs with --mute-audio anyway
export default async function (c) {
  const { page } = c;
  const info = await c.eval(() => ({
    touch: window.__skate.game.input.usingTouch, w: innerWidth, h: innerHeight,
    mode: new URLSearchParams(location.search).get('mode') || 'pro', mute: location.search.includes('mute'),
  }));
  const tag = info.touch ? `m_${info.w > info.h ? 'landscape' : 'portrait'}_${info.mode}` : `d_${info.mode}`;
  const log = (...a) => console.log(`[${tag}]`, ...a);
  const shot = (n) => c.shot(`${tag}/${n}.png`);
  const st = () => c.eval(() => {
    const g = window.__skate.game, q = (s) => document.querySelector(s);
    const vis = (s) => { const e = q(s); if (!e) return null; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
    return {
      menu: window.__pauseMenu?.isOpen, paused: g.paused, locked: !!document.pointerLockElement, tod: window.__skate.state().time,
      mode: q('.modelabel')?.textContent, modeLabel: vis('.modelabel'), lockPill: vis('.lockpill'), hint: vis('.hint'),
      auto: g.input.autoActive, focus: document.activeElement?.textContent?.trim().slice(0, 24) ?? null,
    };
  });
  const audio = () => c.eval(() => {
    const a = window.__skate.game.audio, r = (v) => (v == null ? null : +v.toFixed(3));
    return { ctx: a.ctx?.state ?? null, duck: r(a.duckG?.gain.value), motion: r(a.motion?.gain.value), music: r(a.musicBus?.gain.value),
      sound: r(a.soundBus?.gain.value), lp: r(a.musicLP?.frequency.value) };
  });
  const press = async (k, n = 1, gap = 90) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await c.wait(gap); } };
  await c.api('hud', true);

  if (!info.touch) {
    await c.wait(250); await shot('01_start_hud'); log('t0.6', JSON.stringify(await st()));
    await c.wait(2800); await shot('02_hud_3s'); log('t3.4', JSON.stringify(await st()));
    await c.wait(1900); await shot('03_hud_5s'); log('t5.3', JSON.stringify(await st()));
    await press('KeyH'); await c.wait(350); await shot('04_help_open');
    await press('KeyH'); await c.wait(900); await shot('05_help_closed');

    // Esc → input pause event → game.togglePause → onPause → menu
    await press('Escape'); await c.wait(450);
    log('Esc', JSON.stringify(await st())); await shot('06_pause_main');
    await press('KeyS', 2); await press('KeyD'); await c.wait(900);
    log('S S D (time of day)', JSON.stringify(await st())); await shot('07_pause_nav_tod_sunset');
    await press('KeyA'); await press('KeyS'); await press('KeyA', 4); await c.wait(200);
    log('music after A x4', await c.eval(() => document.querySelector('.pause input[data-key="musicVol"]').value)); await shot('08_pause_nav_music');
    await press('KeyD', 4);
    await press('KeyW', 3); await press('KeyD', 2); await press('Enter'); await c.wait(350);
    log('W x3 D D Enter (Controls)', JSON.stringify(await st())); await shot('09_controls_kb');
    for (const [d, m] of [['kb', 'pro'], ['pad', 'pro'], ['pad', 'easy'], ['touch', 'easy'], ['touch', 'pro'], ['kb', 'auto']]) {
      await c.eval(([d, m]) => window.__pauseMenu.controls(d, m), [d, m]); await c.wait(150); await shot(`10_controls_${d}_${m}`);
    }
    await press('Escape'); await c.wait(600);
    log('Esc resume', JSON.stringify(await st())); await shot('11_resumed_lockpill');

    // control mode switch from the menu: label + hint follow
    const other = info.mode === 'pro' ? 'easy' : 'pro';
    await press('Escape'); await c.wait(400);
    await page.click(`.pause .seg[data-key="controlMode"] [data-v="${other}"]`); await c.wait(250); await shot(`12_pause_mode_${other}`);
    await page.click('.pause [data-act="resume"]'); await c.wait(700);
    log(`mode -> ${other}`, JSON.stringify(await st())); await shot(`13_mode_label_${other}`);
    await press('Escape'); await c.wait(400);
    await page.click(`.pause .seg[data-key="controlMode"] [data-v="${info.mode}"]`); await page.click('.pause [data-act="resume"]'); await c.wait(500);

    // desktop menu pill (top right)
    await page.mouse.move(1180, 28); await c.wait(250);
    await page.click('.topbar .menu'); await c.wait(400); log('menu pill', JSON.stringify(await st())); await shot('14_menu_pill');
    await page.click('.pause [data-act="respawn"]'); await c.wait(500); log('respawn', JSON.stringify(await st()));

    // pointer lock: click the game, then Esc releases it and pauses; Resume clicks lock again
    await page.mouse.click(Math.round(info.w * 0.5), Math.round(info.h * 0.55)); await c.wait(600);
    log('canvas click', JSON.stringify(await st())); await shot('15_after_canvas_click');
    if ((await st()).locked) {
      await press('Escape'); await c.wait(600);
      let s = await st(); log('Esc while locked', JSON.stringify(s));
      // a synthetic Esc may not reach the browser's own unlock: release it the way the browser does (not via the game)
      if (s.locked) { await c.eval(() => document.exitPointerLock()); await c.wait(600); s = await st(); log('user-style unlock', JSON.stringify(s)); }
      await shot('16_lock_esc_menu');
      if (s.menu) { await c.wait(1100); await page.click('.pause [data-act="resume"]'); await c.wait(800); log('Resume click (re-lock)', JSON.stringify(await st())); }
      if ((await st()).locked) { await c.eval(() => window.__skate.game.input.releaseLock()); await c.wait(400); }
      if ((await st()).menu) { await c.eval(() => window.__pauseMenu.close()); await c.wait(300); }
    }

    // start title card (the integrator wires the attract mode)
    await c.eval(() => window.__skate.game.hud.showTitle(true)); await c.wait(700); await shot('17_title');
    await c.eval(() => window.__skate.game.hud.showTitle(false)); await c.wait(1100); await shot('18_title_hidden');

    // Q toggles auto-ride: a short toast says so
    await press('KeyQ'); await c.wait(600);
    log('Q', JSON.stringify(await st()), await c.eval(() => document.querySelector('.toast:not(.hide)')?.textContent ?? null)); await shot('19_auto_toast');
    await press('KeyQ'); await c.wait(600);
    log('Q again', JSON.stringify(await st()), await c.eval(() => document.querySelector('.toast:not(.hide)')?.textContent ?? null));
    await c.wait(1800);

    // gamepad (mocked navigator.getGamepads): Start pauses (input layer), the menu polls D-pad / A / B itself
    await c.eval(() => {
      const pad = { id: 'mock pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      window.__pad = pad; navigator.getGamepads = () => [pad];
    });
    const btn = (i, on) => c.eval(([i, on]) => { const b = window.__pad.buttons[i]; b.pressed = b.touched = on; b.value = on ? 1 : 0; window.__pad.timestamp++; }, [i, on]);
    const tapBtn = async (i) => { await btn(i, true); await c.wait(120); await btn(i, false); await c.wait(160); };
    await tapBtn(9); await c.wait(400); log('pad Start', JSON.stringify(await st()));
    await tapBtn(13); await tapBtn(13); await tapBtn(15); await c.wait(700);
    log('pad down down right (time of day)', JSON.stringify(await st())); await shot('20_pad_nav');
    await tapBtn(14); await tapBtn(1); await c.wait(500); log('pad left + B (resume)', JSON.stringify(await st()));
    await tapBtn(9); await c.wait(400); await tapBtn(0); await c.wait(500); log('pad Start + A on Resume', JSON.stringify(await st()));
    await tapBtn(9); await c.wait(400); await tapBtn(9); await c.wait(500); log('pad Start + Start', JSON.stringify(await st()));
    await c.eval(() => { window.__pad.connected = false; navigator.getGamepads = () => []; });

    if (!info.mute) {
      await press('KeyX'); await c.wait(2500);
      log('audio playing', JSON.stringify(await audio()));
      await press('Escape'); await c.wait(500); log('audio paused (duck .25, lp 1000, motion 0)', JSON.stringify(await audio()));
      await c.eval(() => { const i = document.querySelector('.pause input[data-key="musicVol"]'); i.value = '35'; i.dispatchEvent(new Event('input', { bubbles: true })); });
      await c.wait(400); log('music 35 % (bus .5)', JSON.stringify(await audio()));
      await c.eval(() => { const i = document.querySelector('.pause input[data-key="musicVol"]'); i.value = '70'; i.dispatchEvent(new Event('input', { bubbles: true })); });
      await press('Escape'); await c.wait(700); log('audio resumed (duck 1)', JSON.stringify(await audio()));
    }
  } else {
    await c.wait(300); await shot('01_start'); log('start', JSON.stringify(await st()));
    await c.wait(6500); await shot('02_start_7s');
    await page.tap('.touch .pausebtn'); await c.wait(500);
    log('pause button', JSON.stringify(await st()));
    log('panel', JSON.stringify(await c.eval(() => { const p = document.querySelector('.pause .panel'); return { sh: p.scrollHeight, ch: p.clientHeight, w: p.clientWidth }; })));
    await shot('03_pause');
    await c.eval(() => { document.querySelector('.pause .panel').scrollTop = 1e4; }); await c.wait(150); await shot('04_pause_scrolled');
    await page.tap('.pause [data-act="controls"]'); await c.wait(300); await shot('05_controls');
    await page.tap('.pause [data-act="back"]'); await c.wait(200);
    const other = info.mode === 'pro' ? 'easy' : 'pro';
    await page.tap(`.pause .seg[data-key="controlMode"] [data-v="${other}"]`); await c.wait(150);
    await page.tap('.pause [data-act="resume"]'); await c.wait(800);
    log(`layout -> ${other}`, JSON.stringify(await st())); await shot(`06_layout_${other}`);
    await page.tap('.touch .pausebtn'); await c.wait(400);
    await page.tap(`.pause .seg[data-key="controlMode"] [data-v="${info.mode}"]`); await page.tap('.pause [data-act="resume"]'); await c.wait(600);
    if (info.mode !== 'pro') {
      await page.tap('.touch .autobtn'); await c.wait(700);
      log('AUTO tapped', JSON.stringify(await st())); await shot('07_auto_on');
      await page.tap('.touch .autobtn'); await c.wait(400);
      await page.tap('.touch .flipbtn'); await c.wait(500); await shot('08_trick_tap');
    }
  }
  log('done');
}
