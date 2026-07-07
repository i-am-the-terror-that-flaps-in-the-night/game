// ── Data-driven action bar ───────────────────────────────────────────
// Generates the 10 recruit buttons and 8 build buttons from UNIT_TYPES /
// BUILDING_TYPES instead of hand-written HTML, so cost/roster live in one place
// (js/data/*.js). The generated buttons are functionally equivalent to the old
// inline ones — identical DOM (same ids btn<Capitalized>, classes .btn
// .unit-btn / .bldg-btn, .hotkey/.cost spans, onclick/oncontextmenu handlers),
// differing only in source formatting (compact single line vs the original's
// indented multi-line). That contract is what game-ui.js relies on (updates
// .cost/.disabled by id every frame) and game-input.js (derives unit type from
// btn.id and queries .unit-btn).
import { UNIT_TYPES } from '../data/units.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { btnId, cap, costStr } from '../utils.js';

// [type, hotkey-display-char] in on-screen order. Exported as the single source
// of the roster + hotkeys — game-input.js derives its keyboard map from these.
export const UNIT_ROSTER = [
    ['militia', '1'], ['swordsman', '2'], ['spearman', '3'], ['archer', '4'],
    ['crossbow', '5'], ['cleric', '6'], ['knight', '7'], ['mage', '8'],
    ['catapult', '9'], ['paladin', '0'],
];
export const BUILDING_ROSTER = [
    ['mine', 'Q'], ['barracks', 'W'], ['tower', 'E'], ['wall', 'R'],
    ['academy', 'T'], ['obelisk', 'F'], ['archery', 'G'], ['forge', 'H'],
];
// Per-button accent modifiers (premium/fire units).
const MODIFIER = { paladin: ' btn--gold', forge: ' btn--ember' };

function unitButton([type, key]) {
    const mod = MODIFIER[type] || '';
    return (
        `<button class="btn unit-btn${mod}" id="${btnId(type)}"` +
        ` oncontextmenu="game.toggleAuto('${type}'); return false;"` +
        ` onclick="game.buyUnit('${type}')">` +
        `${cap(type)}<span class="hotkey">${key}</span>` +
        `<span class="cost">${costStr(UNIT_TYPES[type].cost)}</span></button>`
    );
}

function buildingButton([type, key]) {
    const mod = MODIFIER[type] || '';
    return (
        `<button class="btn bldg-btn${mod}" id="${btnId(type)}"` +
        ` onclick="game.build('${type}')">` +
        `${cap(type)}<span class="hotkey">${key}</span>` +
        `<span class="cost">${costStr(BUILDING_TYPES[type].cost)}</span></button>`
    );
}

export function renderActionBar() {
    const units = document.getElementById('unitButtons');
    const buildings = document.getElementById('buildingButtons');
    if (units) units.innerHTML = UNIT_ROSTER.map(unitButton).join('');
    if (buildings) buildings.innerHTML = BUILDING_ROSTER.map(buildingButton).join('');
}
