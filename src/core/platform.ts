import type { Game } from '../game';
import { MOBILE } from './device';

/** Page lifecycle for phones and tablets: audio unlock on every gesture (iOS), pause + audio suspend when the page is
 *  hidden, a screen wake lock while playing / auto-riding, the iOS pinch guard. Installed once at the end of Game.start(). */
export function installPlatform(game: Game) {
  // iOS starts / resumes audio only inside a user activation: a touch pointerdown is not one, pointerup / touchend / click are
  const gesture = () => { game.unlockAudio(); game.audio.gesture(); };
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) addEventListener(ev, gesture, { capture: true, passive: true });

  // phones dim and lock after ~30 s without a touch, and auto-ride is hands-free: keep the screen on while not paused
  let wake: WakeLockSentinel | null = null, asking = false;
  const release = () => { const w = wake; wake = null; w?.release().catch(() => {}); };
  const keepAwake = async () => {
    if (!MOBILE || !('wakeLock' in navigator) || wake || asking || document.hidden || game.paused) return;
    asking = true;
    try {
      const w = await navigator.wakeLock.request('screen');
      w.addEventListener('release', () => { if (wake === w) wake = null; });
      wake = w;
      if (document.hidden || game.paused) release();
    } catch { /* refused: battery saver, permissions policy */ }
    asking = false;
  };
  game.pauseListeners.push((p) => { if (p) release(); else void keepAwake(); });
  addEventListener('pointerup', () => void keepAwake(), { passive: true });

  // backgrounded: pause (the player resumes from the menu) and silence the audio
  const away = () => { game.setPaused(true); game.audio.suspend(); release(); };
  const back = () => {
    // a pointer-lock loss while hidden queued a pause toggle: it must not resume the game on return
    game.input.events.pause = false;
    game.audio.resume();
    void keepAwake();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) away(); else back(); });
  addEventListener('pagehide', away);
  addEventListener('pageshow', (e) => { if (e.persisted) back(); });

  // iOS ignores user-scalable=no: pinch / rotate gestures must not zoom the page
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

  // WebGL context loss: three.js stops the loop and restores it; say why the picture froze
  const cv = game.renderer.domElement;
  cv.addEventListener('webglcontextlost', () => game.hud.toast('Restoring graphics…', 1e9));
  cv.addEventListener('webglcontextrestored', () => game.hud.toast('Restoring graphics…', 0.6));

  void keepAwake();
}
