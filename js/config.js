/* ============================================================
   STICKMAN DOMINION 3.1 - REFACTORED ENGINE & LOGIC
   ============================================================ */

// --- CONFIGURATION ---
// GROUND_Y is the ONE sanctioned mutable field — it is recomputed by
// Game.resize() as the viewport changes. Every other field is a genuine
// constant; the readonly typing below makes an accidental write to them (e.g.
// CONFIG.GRAVITY = …) a typecheck error, while leaving GROUND_Y writable.
/**
 * @type {{
 *   readonly WORLD_WIDTH: number;
 *   GROUND_Y: number;
 *   readonly GRAVITY: number;
 *   readonly EDGE_SCROLL_MARGIN: number;
 *   readonly EDGE_SCROLL_SPEED: number;
 * }}
 */
export const CONFIG = {
    WORLD_WIDTH: 4500,
    GROUND_Y: window.innerHeight - 180,
    GRAVITY: 0.5,
    EDGE_SCROLL_MARGIN: 50,
    EDGE_SCROLL_SPEED: 18,
};

export const TEAMS = { PLAYER: 1, ENEMY: 2 };
export const RESOURCES = {
    START_IRON: 0,
    START_CRYSTAL: 0,
    MAX_MANA: 100,
    MANA_REGEN: 0.05,
};

// Combat-animation frame timers. Set on hit in entity.js (takeDamage) and read
// back as the normalizing divisor in unit-render.js — the two MUST share one
// value or the flinch/flash animation desyncs from its duration.
export const HIT_FLINCH_FRAMES = 7; // flinch duration
export const HIT_FLASH_FRAMES = 5;  // white hit-flash duration

// Necromancer / skull-projectile skeleton summoning (referenced from both
// unit.js and projectile.js — keep the minion type in one place).
export const NECRO_MINION_TYPE = "skeleton";
export const NECRO_SUMMON_INTERVAL = 300; // frames between necromancer summons
export const NECRO_ENEMY_CAP = 60;        // necromancer stops summoning past this many live enemies

// Projectile collision / culling.
export const PROJ_HIT_RADIUS = 30;   // direct-hit proximity for non-arc bolts
export const PROJ_CULL_MARGIN = 200; // despawn this far past either world edge
