import type { Game } from '../game';
import type { AutoSource } from '../core/input';
import { emptyInput } from './physics';

/**
 * Auto-ride autopilot (pass 4, owned by the autopilot helper): rides authored lines through the park using the normal
 * physics and animation. game.ts sets `input.auto = createAutopilot(this)` once the physics exists.
 */
export function createAutopilot(_game: Game): AutoSource {
  return { sample: () => emptyInput(), reset() {} };
}
