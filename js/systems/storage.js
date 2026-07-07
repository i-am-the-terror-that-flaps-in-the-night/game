// --- Persistence helpers ---
// One home for the localStorage JSON round-trip. Reads always swallow parse or
// access errors and return null; every caller falls back to its own defaults.
//
// Writes default to swallowing storage exceptions (meta / achievements
// behavior). Game.saveGame historically let a storage exception propagate, so
// it passes { swallow: false } to keep that exact behavior.
export function loadJSON(key) {
    try {
        return JSON.parse(localStorage.getItem(key));
    } catch (e) {
        return null;
    }
}

export function saveJSON(key, value, { swallow = true } = {}) {
    if (!swallow) {
        localStorage.setItem(key, JSON.stringify(value));
        return;
    }
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        /* storage unavailable */
    }
}

// Every localStorage key the game persists. Keep in sync with the load/save
// sites: game.js (campaign progress + settings), meta.js (renown/unlocks/
// cleared), and achievements.js (unlocked achievements).
export const SAVE_KEYS = [
    "stickman_dominion_save",
    "sd_meta_v1",
    "sd_ach_v2",
];

// Wipe every persisted save. Backs the Settings "Reset Progress" option;
// callers reload afterwards so in-memory state rebuilds from defaults.
export function clearSaves() {
    SAVE_KEYS.forEach((k) => {
        try {
            localStorage.removeItem(k);
        } catch (e) {
            /* storage unavailable */
        }
    });
}
