import { dist } from '../utils.js';

// --- TARGET SELECTION ---
// Combat targeting uses a 1-D horizontal metric (|Δx|): units and towers pick
// the nearest foe along the lane. Healing (below) uses the true 2-D distance.
// This 1-D vs 2-D split is deliberate, shipped behavior — do NOT "unify" them.

// Nearest item to world-x `x`, minimizing |item.x - x|. `accept(item, d)`
// receives the candidate and its distance and returns whether it's eligible
// (towers use `d` for their reach gate). Strict `<` means the first item in
// iteration order wins ties, matching the original hand-rolled loops.
export function nearestX(x, list, accept) {
    let tgt = null,
        best = Infinity;
    for (const e of list) {
        const d = Math.abs(e.x - x);
        if (!accept(e, d)) continue;
        if (d < best) {
            best = d;
            tgt = e;
        }
    }
    return { tgt, d: best };
}

// Lowest-HP-fraction ally within `range` of `self` (a healer's target). Uses
// 2-D distance and excludes full-HP allies (lowHp starts at 1, strict `<`).
export function lowestHpAllyInRange(self, allies, range) {
    let tgt = null,
        lowHp = 1;
    for (const a of allies) {
        if (
            a !== self &&
            a.hp > 0 &&
            a.hp / a.maxHp < lowHp &&
            dist(self.x, self.y, a.x, a.y) < range
        ) {
            lowHp = a.hp / a.maxHp;
            tgt = a;
        }
    }
    return tgt;
}
