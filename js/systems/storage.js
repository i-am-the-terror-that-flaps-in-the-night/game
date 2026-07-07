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
