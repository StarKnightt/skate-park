// Pass-2 media: first frame + HUD over time, in real time as a player sees it (run with --q "test&fps=30" so the sound prompt shows).
// The HUD timers run on game time; the shots after the first frame are taken at given game times (logged with wall time).
export default async function (c) {
  const t0 = Date.now();
  const wall = () => ((Date.now() - t0) / 1000 + 0.4).toFixed(1); // run.mjs waits 0.4 s after ready
  const sim = () => c.eval(() => window.__skate.game.simTime);
  await c.wait(800);
  await c.shot('screens/a_first_frame_golden.png');
  console.log('a_first_frame_golden wall', wall(), 's after ready, game', (await sim()).toFixed(2));
  const untilSim = async (s) => { while ((await sim()) < s) await c.wait(50); };
  await untilSim(0.1);
  console.log('game clock running again at wall', wall(), 's');
  for (const [s, name] of [[2.0, 'a_hud_t02s'], [5.0, 'a_hud_t05s'], [7.5, 'a_hud_t07s']]) {
    await untilSim(s);
    await c.shot(`screens/${name}.png`);
    console.log(name, 'wall', wall(), 'game', (await sim()).toFixed(2));
  }
  await c.page.mouse.move(640, 300); await c.page.mouse.move(700, 330);
  await c.wait(350);
  await c.shot('screens/a_hud_pointer_move.png');
  await c.page.keyboard.press('KeyH');
  await c.wait(600);
  await c.shot('screens/a_hud_help_open.png');
  await c.page.keyboard.press('KeyH');
  await c.wait(900);
  await c.shot('screens/a_hud_help_closed.png');
}
