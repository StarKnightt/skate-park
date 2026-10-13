import './ui/style.css';
import { Game } from './game';

const game = new Game(document.getElementById('app')!);
game.start().catch((e) => {
  console.error(e);
  const l = document.querySelector('.loading .s');
  if (l) l.textContent = 'Something went wrong while loading: ' + (e?.message ?? e);
});
