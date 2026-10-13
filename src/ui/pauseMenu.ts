import type { Game } from '../game';

/**
 * Pause menu (pass 4, owned by the UI helper). game.ts calls installPauseMenu(this) once at the end of start().
 * All wiring goes through the public Game API (game.onPause, game.setPaused, game.input, game.audio, settings).
 */
export function installPauseMenu(_game: Game) {
  /* TODO pass 4 (UI helper) */
}
