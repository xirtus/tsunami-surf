import { Game } from './game/Game.js';

const game = new Game(document.getElementById('app'));
game.start();

// expose for debugging / console tuning
window.__game = game;
