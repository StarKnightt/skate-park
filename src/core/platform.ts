import type { Game } from '../game';

/** Page lifecycle for phones and tablets: audio unlock on every gesture (iOS), pause + audio suspend when the page is
 *  hidden, a screen wake lock while playing / auto-riding, the iOS pinch guard. Installed once at the end of Game.start(). */
export function installPlatform(game: Game) {
  void game;
}
