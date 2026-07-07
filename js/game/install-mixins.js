// Assemble Game.prototype from its concern-split mixin modules in ONE place, in
// a fixed order. This replaces the former arrangement where each game-*.js did
// its own `Object.assign(Game.prototype, …)` and imported Game back (a pseudo-
// circular dependency), relying on main.js importing all five for their side
// effects before `new Game()`. Importing this module runs the install; main.js
// imports it before constructing the Game.
//
// Method names do not overlap across the five objects, so the order only fixes a
// deterministic install sequence (it matches the historical main.js import order).
import { Game } from './game.js';
import { flowMethods } from './game-flow.js';
import { economyMethods } from './game-economy.js';
import { inputMethods } from './game-input.js';
import { uiMethods } from './game-ui.js';
import { renderMethods } from './game-render.js';
import { bossMethods } from './game-boss.js';

Object.assign(
    Game.prototype,
    flowMethods,
    economyMethods,
    inputMethods,
    uiMethods,
    renderMethods,
    bossMethods,
);
