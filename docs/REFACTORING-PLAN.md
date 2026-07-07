# Refactoring Specification — Stickman Dominion: Warlords (v4.4.x)

## Context

This is a released, production browser game (vanilla JS + HTML5 Canvas, ES modules, no bundler, no framework, ~5,500 lines of JS across 29 files), deployed as a static site (Cloudflare Workers serving the repo root). The owner wants a maintainability/reliability refactoring plan with **zero behavior change**: no gameplay, balancing, visual, control, save-format, or deployment changes; no framework; no redesign. The vanilla JS + Canvas + ES-module architecture stays.

The only automated verification today is `npm run typecheck` (`tsc --noEmit`, checkJs). No tests, no lint, no build step. That shapes everything: **Phase 0 builds a safety net before anything moves.**


**Deliberate design decisions to respect (documented in README.md and types/*.d.ts):**
- `window.game` singleton is intentional; ~30 inline `onclick="game.…"` handlers in `index.html` plus entity/system code reference the bare global. README: decoupling it is "deliberately out of scope."
- No build step ships — raw ES modules deploy as-is.
- Data tables (`js/data/*.js`) are strictly typed via `types/data.d.ts`; the Game/Unit/Building god object is deliberately typed permissively via `types/augment.d.ts`.

---

## 1. Architecture analysis

### 1.1 Module boundaries (current)

```
js/config.js         CONFIG, TEAMS, RESOURCES  (CONFIG is mutable at runtime — see 1.3)
js/utils.js          math/color/IK/format helpers + DOM helper particleQuality()
js/data/*.js         pure stat tables: UNIT_TYPES, ENEMY_TYPES, BUILDING_TYPES, SPELLS, TECH_TREE, LEVELS
js/entities/         Entity base, Unit (players AND enemies), Building, unit-render.js (Unit.prototype.draw mixin)
js/systems/          combat, waves, projectile, spell-manager, vfx, audio, camera, meta, achievements
js/game/             Game class split across 6 files via prototype mixins
js/ui/action-bar.js  generates the 18 recruit/build buttons from data tables
js/main.js           entry: side-effect imports → renderActionBar() → new Game() → window.game
```

Layering is decent on paper (data → entities/systems → game → main) but bypassed at runtime by the ambient `game` global.

### 1.2 Prototype mixins

`Game` is assembled from 6 files. `js/game/game.js:14` defines the class (constructor, loop, update, save/load, victory/defeat). Five siblings each run `Object.assign(Game.prototype, {...})` at module load:

| File | Adds |
|---|---|
| `game-flow.js:8` | startCampaign, startEndless, loadLvl, returnToMenu, callWave, restartLevel, nextLevel |
| `game-economy.js:11` | addGold, checkCost, payCost, unitCost, buildCost, toggleAuto, buyUnit, build, spawnEnemy, buyTech |
| `game-input.js:16` | bindEvents, pickAt, selectSpell, setFormation |
| `game-ui.js:11` | openTechTree, setActionTab, notify, updateSelUI, updateUI, drawMinimap, … |
| `game-render.js:7` | _buildBackdropCache, drawBackdrop, drawForeground, drawPostFX, draw |

Same pattern in the entity layer: `entities/unit-render.js:6` assigns `draw()` onto `Unit.prototype` (while `Building` defines `draw` inline — asymmetric).

**Fragility:** each mixin file imports `Game` from `game.js` (circular), and the `Game` constructor calls mixin methods (`bindEvents()`, `loop()` → `draw()`). This works only because `main.js:4-9` imports the mixin modules for side effects *before* `new Game()` on line 22. Nothing enforces the ordering except a comment.

### 1.3 Global state

- `window.game` (`main.js:23`) — the world handle. Only `AchievementSystem`, `MetaProgression`, `WaveManager`/`EndlessWave` receive an injected `this.g`; everything else (`unit.js`, `building.js`, `projectile.js`, `spell-manager.js`, `combat.js:58`) reads the bare global.
- `game.achievements` is `null` in the constructor and monkey-patched after construction (`main.js:24`) — order-dependent.
- `CONFIG` (`config.js:6`) is **not constant**: `CONFIG.GROUND_Y` is initialized from `window.innerHeight` at module load and reassigned in `Game.resize()` (`game.js:136-139`).
- `combat.js:58` — `resolveDamage()` reads `game.formation` through a `typeof game !== "undefined"` guard: the one impurity in an otherwise pure combat module.
- `camera.js:16` — `pan()` reads `window.innerWidth` directly.
- `utils.js:9` `_hexCache` — exported mutable memo cache (harmless).

### 1.4 Entity design

- `Entity` (`entity.js:5`): position/hp, `takeDamage`/`heal`/`die`, `drawHp`, `drawDmg`.
- `Unit extends Entity` models **both player units and enemies** — the constructor branches on team to pick `UNIT_TYPES` vs `ENEMY_TYPES` (`unit.js:13-16`). There is no Enemy class.
- `Building extends Entity` reads `BUILDING_TYPES[type]`.
- Rendering dispatches on stringly-typed `vis` fields (`"sword_shield"`, `"catapult"`, `"dragon"`, …) — an implicit enum shared between `data/*.js` and `unit-render.js` with no central definition.
- Dead entities linger in the live arrays while damage text drains: filters keep `u.active || u.dmgTexts.length > 0` (`game.js:277-286`). Code iterating these arrays must not assume members are alive.

### 1.5 System communication

No event bus. Three coexisting patterns:
1. **Ownership + direct calls** — Game constructs/owns audio, camera, particles, fx, decals, weather, spells. Fine.
2. **Constructor injection** (`this.g`) — achievements, meta, wave managers. The good pattern, used 3 times.
3. **Ambient global** — entities and SpellManager reach into `game.*` for everything. Dominant pattern; the import graph *understates* real coupling.

Input handling is split: `game-input.js` binds most listeners, but `SpellManager`'s constructor registers its own `document` keydown + canvas contextmenu listeners (`spell-manager.js:11-28`).

### 1.6 Dependency problems

Circular imports (all currently working via import-order luck / late binding):
- `game.js ⇄ game-*.js` (×5, the mixin cycle)
- `unit.js ⇄ combat.js` (combat imports `Unit` only for one `instanceof`)
- `building.js → projectile.js → combat.js → building.js` (combat imports `Building` only for one `instanceof`)
- `unit.js ⇄ unit-render.js`

DOM ids are an implicit cross-file contract: `btn${Cap(type)}` shared by `index.html`, `ui/action-bar.js`, `game-ui.js`, `game-input.js`, `utils.js:btnId`.

### 1.7 Game loop

`game.js:368-381`: single RAF loop; `dt` normalized to 60fps units, clamped at 3; `this.ts` (0/1/2) scales update and draw. `update()` ends by calling `updateUI()` — ~25 `getElementById(...)` DOM writes **per frame** inside the simulation update (`game-ui.js:108-262`), plus a per-frame minimap redraw. Every frame allocates `[...buildings,...units,...enemies,...projectiles]` for update and rebuilds + sorts a combined draw array (`game-render.js:367-374`).

---

## 2. Technical debt inventory

### 2.1 Large files
Nothing monstrous (largest is 658 lines), but four files mix concerns: `unit-render.js` (658 — all stickman rendering, `vis`-string feature flags), `game-render.js` (453), `unit.js` (436 — AI + combat + XP + drops + necromancer special cases), `game-ui.js` (301 — per-frame HUD sync + dialogs + minimap).

### 2.2 Duplicated logic (verified, file:line)
1. **Nearest-target scan** (min over `Math.abs(dx)`): `unit.js:165-174` (enemies), `unit.js:176-183` (buildings fallback), `building.js:68-83` (tower targeting). Healer targeting (`unit.js:127-138`) uses 2-D `dist()` — the 1-D vs 2-D inconsistency is **live behavior and must be preserved**.
2. **`resolveDamage` → `takeDamage` src-bag boilerplate** ×4: `unit.js:283-294`, `unit.js:307-308`, `projectile.js:159-160`, `projectile.js:198-199`.
3. **Explosion VFX block** (ring ×2 + flash + scorch decal + shake clamp): `unit.js:313-318` vs `projectile.js:211-221` — same structure, different literals in every slot.
4. **Wave spawning**: `WaveManager.spawn` (`waves.js:42-60`) vs `EndlessWave.spawn` (`waves.js:166-180`); `canCall`/`callWave` pairs (`waves.js:33-41` vs `117-123`). The managers duck-type one interface with different invariants (EndlessWave has no `pending`; `isComplete()` always false).
5. **localStorage try/catch JSON round-trip** ×3: `game.js:87-131`, `meta.js:31-50`, `achievements.js:17-26`.
6. Necromancer→skeleton summon linkage hardcoded twice: `unit.js:232-240`, `projectile.js:141-142`.

### 2.3 Magic numbers / data-in-code
- Hurt/flash timers 7/5 set in `entity.js:18-19` and **mirrored as divisors** `/7`, `/5` in `unit-render.js:23-24` — a live trap.
- Damage-text colors/sizes (`entity.js:22-27`); atk decay 0.085 / recoil 0.78 (`unit.js:110,114`); formation hold-x 320/700/450, aggressive −80 (`unit.js:218,222`); charge 120/×1.8 (`unit.js:197`); XP curve inline (`unit.js:69-81`).
- **Death drop tables in code**: crystal (shaman 2, necromancer 5, dragon 25) and iron (marauder 1 … ogre 10) as if-chains in `unit.js:411-419` — pure balance data belonging in `data/enemies.js`.
- Projectile stat table inline in the constructor (`projectile.js:31-55`); hit radius 30, cull ±200 (`projectile.js:117,120`).
- `drawHp` per-callsite pixel offsets (`unit-render.js:644,122,197`, `building.js:273`).
- Forge/archery completion buffs ×1.25/×1.20/×1.15/+0.25 (`building.js:41-56`); SFX tuples (`audio.js:43-66`); loop constants dayT 0.0002, income ÷60, autoTimer 60, shake 0.9/0.5, achievements %180, dt clamp 3 (`game.js:222-301,371`).

### 2.4 Stringly-typed dispatch
- `Building.draw`: 6-branch `if (this.type === …)` (`building.js:150-271`).
- `unit-render.js`: `vis`-string branches + `.includes()` lists (`:87-90, :93, :128, :203, :401`) — feature flags, not a single dispatch chain.
- `SpellManager.cast`: 4-branch if on spell id (`spell-manager.js:119-232`) — spell *behavior* in the manager, *stats* in `data/spells.js`; adding a spell touches both. Keybinds `KeyZ…KeyV` hardcoded (`spell-manager.js:17-20`).
- Projectile damage-type inferred from projectile-type string (`projectile.js:20`).
- The in-repo good model: `combat.js` `COUNTER_TABLE` — data-driven, pure, testable.

### 2.5 Hard-to-test systems
Pure or nearly pure today: `utils.js` (except `particleQuality`), `combat.js` (except the `game.formation` read), `camera.js` (except `window.innerWidth`), all `data/*.js`. Everything else is entangled with `window.game` + canvas + DOM. `SpellManager` cannot even be constructed without a DOM.

### 2.6 Risky areas (respect during any refactor)
- Prototype-mixin load order (silent breakage if side-effect imports reorder).
- Game constructor order is load-bearing: `loadSave()` touches DOM inputs; `MetaProgression` needs `this.audio`; achievements attached post-construction.
- In-flight `setTimeout` wave/spell callbacks can fire into a reset/restarted run (they re-check `game.state`, but a fast restart is `"playing"` again). Latent bug — fixing it is a **behavior change**, out of scope; flag to owner.
- Mid-frame array mutation: `spawnEnemy` pushes to live arrays during update (necro summon `unit.js:236`, skull `projectile.js:142`); the spread-snapshot in the update loop is what keeps this safe.
- **Buff-ordering semantics are behavior**: `bldg_hp` bakes into `Building.maxHp` at construction; forge/archery buffs mutate *existing* units at completion; tech applies at spawn only. Build-order affects results — shipped behavior, do not "fix".
- **Save formats (byte-compatible, hard constraint)**:
  - `"stickman_dominion_save"` → `{maxUnlockedLevel, bestEndlessWave, volSound, volMusic, pq}` — vol/pq are DOM `.value` **strings**, must stay strings
  - `"sd_meta_v1"` → `{renown, unlocked:[…], cleared:[…]}` (Sets as arrays)
  - `"sd_ach_v2"` → bare JSON array of achievement ids
- `CONFIG.GROUND_Y` mutated on resize; entities keep stale `y` after resize (accepted behavior).

---

## 3. Refactoring roadmap

**Ground rules for every item:**
- Invariant: zero observable behavior change. `window.game` and inline `onclick` handlers stay.
- Gate for every step: `npm run typecheck` clean vs. baseline + smoke script green (0.3) + the item's manual QA.
- Extractions are **literal-for-literal code motion** — reviewer confirms the diff is pure motion (no re-derived arithmetic, no `<`→`<=`, no iteration reordering).
- One phase per branch, one item per commit → any regression bisects to one small diff.

### Phase 0 — Safety nets & baseline

**0.1 Git baseline** — Files: none. Tag the current release commit `v4.4.x-pre-refactor`; work on `refactor/phase-N` branches. Risk: zero. Verify: `git tag` lists it.

**0.2 Typecheck baseline** — Files: `package-lock.json` (new). `npm install` (typescript ^6 is declared but not installed), run `npm run typecheck`, record the error count (expected 0) as the baseline every later step must not exceed. Do NOT touch `tsconfig.json` strictness or `types/*.d.ts` shims yet. Risk: zero.

**0.3 Headless smoke script (the workhorse gate)** — Files (new): `tools/smoke.mjs`, `tools/fixtures/*.json`; add `"smoke"` script to package.json. Playwright + the pre-installed headless Chromium; no build step needed:
1. Serve the repo (`python3 -m http.server 8000` or a tiny `node:http` server — ES modules need http, not `file://`).
2. Fail the run on any `pageerror` or `console.error`.
3. Boot: load `/index.html`, wait for `window.game` && `game.state === "menu"`.
4. Run: `game.startCampaign()`, then `game.setSpeed(2)` (**not 3 — only `btnSpeed1`/`btnSpeed2` exist; `setSpeed(3)` throws**); poll ~20s; assert castle exists, gold increased, enemies appeared, no exceptions.
5. Interaction: `game.buyUnit('militia')` (assert pop/gold delta); `game.spells.mana = 999; game.spells.select('meteor')` + synthetic canvas `mousedown` (assert mana decreased); `game.callWave()`.
6. Lifecycle: `game.returnToMenu()` → `game.startEndless()` → force defeat via `takeDamage(1e9)` on the castle → assert `state === "defeat"` and `#gameOver` visible.
7. **Save-format fixture test**: pre-seed localStorage with fixtures for all three keys (note `volSound`/`pq` as strings: `{"maxUnlockedLevel":3,"bestEndlessWave":7,"volSound":"70","volMusic":"40","pq":"1"}`); after boot trigger each save path; assert stored strings deep-equal the fixtures. This one test protects every persistence change (2.1).
8. Optional: fixed-frame canvas screenshot into `tools/baseline/` for threshold pixel-diff on render-touching items (3.5, 3.6, 1.5).

Risk: zero to the game (new files only). Note: Cloudflare serves the repo root, so `tools/` becomes publicly fetchable — harmless; adding it to `.assetsignore` touches deployment config, so only with owner sign-off. Verify: script passes twice on the untouched baseline before any refactor starts.

**0.4 Manual QA checklist** — Files (new): `docs/QA-CHECKLIST.md`. Covers what headless can't: boot → campaign L1 → recruit each unit → build mine/tower/barracks → all 4 spells via keys (Z/X/C/V) and buttons → formations → call wave early → win L1 (victory stats + Renown) → endless → die (best-wave saved) → reload page (Resume Campaign (N), volumes persisted) → resize mid-game → pause/speed. Risk: zero.

### Phase 1 — Zero-risk cleanup

**1.1 Named constants (mirrored ones first)** — Files: `js/config.js` (or new `js/constants.js`); consumers `entity.js`, `unit.js`, `unit-render.js`, `projectile.js`, `game.js`.
Priority targets are the *mirrored* literals (active traps): `HIT_FLINCH_FRAMES = 7` / `HIT_FLASH_FRAMES = 5` (set `entity.js:18-19`, consumed as `/7`, `/5` in `unit-render.js:23-24`); `NECRO_MINION_TYPE = "skeleton"` + summon interval 300 + enemy cap 60 (`unit.js:232-240`, `projectile.js:141-142`); `PROJ_HIT_RADIUS = 30` / `PROJ_CULL_MARGIN = 200`; loop constants in `game.js` (DAY_CYCLE_RATE, AUTOQUEUE_INTERVAL, SHAKE_DECAY/FLOOR, ACH_CHECK_INTERVAL, DT_CLAMP). Purely local tunables (atk decay, XP thresholds, formation hold-x, dmg-text colors, audio tuples, forge multipliers) become file-top `const`s in their own files — no cross-file module needed.
Risk: zero (identifier substitution). Verify: typecheck + smoke; diff shows literal-for-literal only.

**1.2 DOM element cache** — Files (new): `js/ui/dom.js` with `el(id)` (lazy Map over `getElementById`, `console.warn` on null). Convert `game-ui.js` first (~25 lookups/frame), then `game.js`, `game-input.js`, `spell-manager.js`, `meta.js`, `achievements.js`, `utils.js`.
Safe because every cached element is static in `index.html` or generated once by `renderActionBar()` before `new Game()`; no code replaces those nodes (overlays set `innerHTML` *on themselves*, which keeps the reference valid).
Risk: low. Verify: smoke (HUD updates, buttons enable/disable) + one full manual pass.

**1.3 `updateUI` write-on-change** — Files: `game-ui.js:108-262`, `spell-manager.js:67-73`. Helper `setText(id, str)` in `js/ui/dom.js` that skips identical writes (same for `disabled`/class toggles). Rendered output identical by construction; stops per-frame layout/paint churn.
Risk: low (hazard: out-of-band writes to the same element making the cache stale — grep each id before converting). Verify: smoke + manual (gold/mana tick, buttons grey at low mana). **Do NOT throttle `updateUI` to every N frames — that visibly lags counters (behavior change).**

**1.4 `dealDamage` helper** — Files: `combat.js` (add), `unit.js:283-294,307-308`, `projectile.js:159-160,198-199`.
`export function dealDamage(base, src, target) { const r = resolveDamage(base, src, target); target.takeDamage(r.amt, r.tag); return r; }` — melee keeps the return (reads `r.tag === "strong"` for crit FX). Also add `Unit.prototype.combatSrc()` building the `{dmgType, armorPierce, vsLarge, vsFlying, siege, team, isUnit:true}` bag; the ranged path today omits `siege`/`team` (Projectile fills them) — keep Projectile overwriting those two so the merged `src` is field-identical.
Risk: zero/low. Verify: typecheck + smoke; review asserts field-set identity per site.

**1.5 Explosion-VFX helper (optional)** — Files: `vfx.js` (add `explosionFX(g, x, y, opts)`), `unit.js:313-318`, `projectile.js:211-221`. The two blocks share structure but differ in every literal (colors, radii multipliers, scorch scale, shake caps, conditional `playExplosion`); the helper must take all of it as explicit params, each call site passing its exact current values. If the param bag reads worse than the duplication, **skip**.
Risk: low. Verify: screenshot-diff catapult AoE + paladin slam; smoke.

### Phase 2 — System organization

**2.1 Persistence helper + fixtures** — Files (new): `js/systems/storage.js`; consumers `game.js:87-131`, `meta.js:31-50`, `achievements.js:17-26`.
`loadJSON(key)` → value or null (swallows). Careful on save: `meta`/`achievements` wrap `setItem` in try/catch today; `game.js:118` does **not** (a storage exception currently propagates out of `victory()`) — preserve via a `{swallow}` flag or leave `saveGame`'s `setItem` raw. Keys and shapes byte-identical: vol/pq stay DOM-`.value` strings (no `Number()`), meta keeps `[...Set]`, achievements stays a bare array. Key-name constants OK; values unchanged.
Risk: low. Verify: the 0.3 fixture test is the gate.

**2.2 Spell behavior registry + data-driven keybinds** — Files (new): `js/systems/spell-behaviors.js`; modified `spell-manager.js:119-232` (cast), `:17-20` (keys); `data/spells.js` (add `key: "KeyZ"` per spell).
`SPELL_BEHAVIORS = { meteor(g, sp, w, wy){…}, blizzard…, heal…, lightning… }` — each body a verbatim cut-paste of its branch. `cast()` keeps the shared preamble (mana deduction, `toWorld`, `wy` clamp, `playMagic`) exactly where it is, then dispatches. Lightning keeps its `SPELLS.lightning` reference and `Math.pow(0.82, idx)` falloff untouched. Keydown becomes a loop over `SPELLS` matching `e.code === def.key`; preserve mapping + Escape-cancel exactly. In-flight `setTimeout` callbacks move verbatim including their `game.state !== "playing"` guards.
Risk: low (code motion + table lookup). This is the highest-leverage future-dev win: spell #5 becomes one data entry + one behavior function. Verify: smoke casts each spell via key and button; manual: all 4 spells, right-click/Escape cancel, cast blocked while paused.

**2.3 Input consolidation** — Files: `spell-manager.js:11-60` (constructor listeners → new `bindInput(game)` method), `game-input.js` (`bindEvents` calls `this.spells.bindInput(this)`).
Move the five `addEventListener` calls verbatim. Ordering is safe (both attach points are inside the same synchronous constructor run — no event can fire in the gap). Canvas `mousedown` relative order flips (SpellManager now registers after game-input's), but the handlers are mutually exclusive: game-input early-returns when `this.spells.active`; SpellManager only acts when `this.active`. State that audit in the PR. SpellManager becomes constructible without DOM.
Risk: low. Verify: manual — spell click casts without selecting a unit; plain click selects; touch cast; right-click cancel.

**2.4 Wave spawn scheduler + explicit interface** — Files: `waves.js` only, + a JSDoc typedef.
Extract `scheduleSpawns(g, plan)` with `plan = [{type, delayMs, xMin, xMax, track}]`, preserving each manager's exact math: campaign per-group `i*700 + rand(0,200)` (index resets per group), x `WORLD_WIDTH − rand(100,400)`, `track:true` (pending++/--); endless cumulative index × 500ms, x `WORLD_WIDTH − rand(50,300)`, `track:false`. Keep the `g.state === "playing"` guard inside the timeout.
Do **NOT** base-class `canCall/callWave/isComplete` — the differences are semantics, not duplication. Instead add `@typedef WaveController` (`update`, `isComplete`, `canCall`, `callWave`, `cw`, `tw`, `wave?`) and annotate `game.waveM` — the implicit interface becomes typechecked.
Risk: low (delay/jitter/x-range expressions must survive byte-identical). Verify: smoke (waves in both modes, `callWave`); manual: meteor-wipe a wave and confirm no premature victory (`pending===0` gate intact).

**2.5 Update-loop hygiene** — Files: `game.js:270-275`, `game-render.js:367-374`.
Replace the 4-array spread with four consecutive `forEach` calls **in the same order** (buildings, units, enemies, projectiles). Semantics proof: today's spread snapshots, so mid-frame pushes aren't visited this frame; `forEach` fixes its range before the first callback, so appended elements are likewise skipped. **Do not use an index `for` loop** (it would visit appendees — a skeleton would act one frame early). Keep the four `filter` passes (corpse-lingering is deliberate). Draw: reuse one persistent scratch array (`length = 0`, push, sort) preserving exact concat order; `sort` is spec-stable so y-ties keep order.
Risk: low but this is the Phase-2 item where a subtle mistake changes gameplay — put the forEach-not-for rule in a code comment. Verify: smoke + manual endless Dark Ritual wave (necromancer skeletons behave normally).

**2.6 Document (don't change) constructor/monkey-patch ordering** — Files: comments in `main.js`, `game.js` header. The `achievements = null` → post-construction patch is load-bearing (AchievementSystem touches the bare `game` global which exists only after the constructor returns; `update()` null-guards at `game.js:301`). Write the ordering contract down: `renderActionBar()` → `new Game()` (mixins installed; loadSave before bindEvents; bindEvents before loop) → `window.game =` → `new AchievementSystem`. Risk: zero.

### Phase 3 — Entity architecture

**3.1 Targeting helpers** — Files (new): `js/systems/targeting.js`; consumers `unit.js:127-138,165-183`, `building.js:68-83`.
- `nearestX(x, list, accept)` — min over `Math.abs(e.x − x)`, strict `<` (first-in-array wins ties). Call sites keep their exact accept logic: unit enemy scan (`e.hp>0 && !(e.flying && !this.ranged)`); unit building fallback (two-pass structure kept verbatim); tower scan (per-candidate reach: `d <= (t.flying && this.flyRange ? this.flyRange : this.range)` — `<=` on reach vs `<` on min both preserved).
- `lowestHpAllyInRange(self, allies, range)` — verbatim healer scan: 2-D `dist()`, `lowHp` starts at 1, strict `<`. Keep it a **separate** helper; comment that the 1-D vs 2-D split is shipped behavior to stop future "fixes."
Risk: low. Verify: typecheck + smoke; manual: melee ignores dragons, towers flak dragons at long range, clerics heal the most-wounded ally.

**3.2 Data-driven drop tables** — Files: `data/enemies.js` (add `drops`), `unit.js:411-419`, `types/data.d.ts` (optional `drops?: {crystal?, iron?}`).
Add `drops: {crystal: 2}` etc. to exactly the seven types; `die()` reads `ENEMY_TYPES[this.type]?.drops`. The dragon achievement flag (`unit.js:421`) stays code (not a drop).
Risk: low. Verify: smoke kills a shaman via script and asserts `game.crystal` +2; diff review matches the seven numbers.

**3.3 Projectile defs → data module** — Files (new): `js/data/projectiles.js`; modified `projectile.js:19-20,31-55`; `types/data.d.ts` (`ProjectileDef`).
Verbatim move of the five entries; the name-based dmgType inference (`fireball|skull → magic`, else `pierce`) becomes an explicit `defaultDmgType` field; constructor reads `o.dmgType || def.defaultDmgType`.
Risk: zero/low. Verify: typecheck; smoke; manual: arrows arc, fireballs glow+AoE, catapult rocks, necro skulls summon.

**3.4 `vis` registry (validation, not dispatch)** — Files (new): `KNOWN_VISUALS` set (in `data/units.js` or `js/entities/visuals.js`); consumer `unit.js` constructor.
`unit-render.js` uses `vis` as scattered *feature flags* (~20 sites), not one dispatch chain — a visual→drawFn registry would be a rewrite for nothing. The cheap win: enumerate the known strings, `console.warn` on unknown in the Unit constructor, and add a JSDoc string-union on `EntityDef.visual` in `types/data.d.ts` so typecheck flags typos in data.
Risk: zero (warn-only). Verify: typecheck; boot with no warnings.

**3.5 HP-bar anchors from data** — Files: `data/units.js`/`data/buildings.js` (optional `hpBar: {w, offY}`), `unit-render.js:122,197,644`, `building.js:273`.
For each call site record the exact `(w, offY)` (incl. scale math); draw becomes `drawHp(ctx, cam, def.hpBar?.w ?? <old default>, def.hpBar?.offY ?? <old default>)`. Number-for-number.
Risk: low but fiddly — exactly what the 0.3 screenshot diff exists for. Verify: pixel-diff a battle with damaged units/buildings/dragon.

**3.6 Building.draw dispatch table (optional)** — Files: `building.js:150-271`. Internal `const DRAWERS = {castle(){…}, mine(){…}, …}` map + default; pure code motion in one file. Do NOT move it to a `building-render.js` "for symmetry" — that adds a prototype-ordering dependency for nothing.
Risk: low. Verify: screenshot diff of a base with every building type.

### Phase 4 — Dependency cleanup

**4.1 Break import cycles: `kind` flags replace `instanceof`** — Files: `combat.js:5-6,45,61`, `building.js` (+1 line), `unit.js` (+1 line), `types/augment.d.ts`.
Set `this.kind = "building"` / `"unit"` in the two constructors (name it `kind`, **not** `isUnit` — that name is taken by the damage-source bags; collision would silently corrupt formation math). Replace the two `instanceof` checks; delete the `Unit`/`Building` imports from combat.js. This kills the unit⇄combat and building→projectile→combat→building cycles. Equivalence: every `target` reaching `resolveDamage` is constructed by exactly one of those two constructors.
Risk: low. Verify: typecheck; smoke; manual: catapult ×2 siege vs buildings; defensive formation reduces damage to player units only.

**4.2 `resolveDamage` takes formation explicitly** — Files: `combat.js:43,58-62`; callers `unit.js`/`projectile.js` (or just `dealDamage` if 1.4 landed).
Add a `formation` param; body uses `FORMATION_MODS[formation]` (falsy → no modifier, same as today's guard). `dealDamage` reads `game.formation` and passes it down — same value read in the same call stack, timing identical. Spells call `takeDamage` directly, unaffected. combat.js becomes fully pure/unit-testable.
Risk: low. Verify: typecheck; manual: switch formations mid-fight, damage numbers/colors as before.

**4.3 Explicit mixin installation (no class conversion)** — Files: the five `game-*.js` (each `Object.assign(Game.prototype, {…})` → `export const flowMethods = {…}`, dropping their `import { Game }`), new `js/game/install-mixins.js` (imports Game + the five objects, one ordered `Object.assign`), `main.js` (five side-effect imports → one import).
Keep the `/** @type {ThisType<any>} */` annotations. Assign in current main.js order (flow, economy, input, ui, render); grep first to confirm no method-name shadowing and state it in the PR. Add a dev assert in main.js before `new Game()`: `if (typeof Game.prototype.bindEvents !== "function") throw …`. Optional follow-up: `types/game-methods.d.ts` declaring mixin method signatures, incrementally shrinking the `[key:string]:any` shim.
Result: the "prototype assembled before construction" contract lives in one file; a mis-ordered import becomes impossible instead of a silent boot failure.
Risk: low-medium (7 files, but every hunk is a wrapper swap; failure is immediate and loud, caught by smoke boot). Verify: smoke + typecheck + manual sanity.

**4.4 Camera viewport injection** — Files: `camera.js:16`, `game.js` `resize()`. Camera gets `viewW` (initialized from `window.innerWidth` in its constructor; updated by `Game.resize()`, which already runs at construction and on every resize). `pan()` uses `this.viewW`. Values identical at all times.
Risk: low. Verify: manual edge-scroll to both world ends, resize mid-game, clamping identical.

**4.5 CONFIG mutability: compile-time readonly** — Files: `config.js` (comment), `types/` d.ts. `GROUND_Y` is legitimately mutable (written only by `Game.resize()`, read in ~22 places); migrating it or `Object.freeze(CONFIG)` would break resize or risk a 22-site miss. Instead: comment "GROUND_Y is the one sanctioned mutable field", and declare CONFIG with every field `readonly` except `GROUND_Y` so typecheck rejects new mutations.
Risk: zero. Verify: typecheck (temporarily add `CONFIG.GRAVITY = 1` locally, confirm it errors, revert).

---

## 4. Priority ranking (benefit ÷ (risk × difficulty))

| Rank | Item | Benefit | Risk | Difficulty |
|---|---|---|---|---|
| 1 | 0.1–0.4 safety nets | enables everything | zero | low — **non-negotiable first** |
| 2 | 2.1 storage helper + fixtures | save reliability, formats locked | low | low |
| 3 | 1.4 dealDamage + combatSrc | 4-site dedupe, feeds 4.2 | zero-low | low |
| 4 | 1.2 + 1.3 DOM cache + write-on-change | per-frame DOM cost gone | low | low |
| 5 | 2.2 spell registry + keybind data | biggest future-dev win | low | medium |
| 6 | 3.2 + 3.3 drop tables & projectile defs | data where data belongs | low | low |
| 7 | 4.1 kind flags | kills all 3 import cycles | low | low |
| 8 | 3.1 targeting helpers | 3-site dedupe, metrics documented | low | medium |
| 9 | 2.4 wave scheduler + typedef | dedupe + explicit interface | low | medium |
| 10 | 2.3 input consolidation | one input surface, testability | low | low |
| 11 | 4.3 install-mixins | boot contract made real | low-med | medium |
| 12 | 1.1 constants | trap removal (mirrored pairs first) | zero | low |
| 13 | 2.5 loop hygiene | GC pressure | low* | medium (*semantics argument must be airtight) |
| 14 | 4.2 / 4.4 / 4.5 purity cleanups | testability | low/zero | low |
| 15 | 3.4 / 3.5 / 3.6 / 1.5 polish | nice-to-have | low | low-med — only if touching those files anyway |

**Advise AGAINST (explicitly out of scope):**
- Converting mixins to real classes or namespaced sub-objects (`game.input.*`) — inline `onclick` handlers and internal `this.x()` calls assume a flat Game surface; 4.3 delivers ~90% of the safety at ~10% of the churn.
- Throttling `updateUI` (visible lag = behavior change).
- Replacing wall-clock `setTimeout` wave/spell scheduling with dt-based timers — it would fix real quirks (spawns dropped if a timeout fires while paused; blizzard ticks on wall time regardless of game speed; stale timers firing into a restarted run) but those are **shipped gameplay behavior**; flag to owner as known issues, change only with explicit sign-off.
- "Fixing" the 1-D vs 2-D distance inconsistency, corpse-lingering filters, or buff-application ordering — balance-relevant shipped behavior.
- Adding `pending`/real `isComplete` to EndlessWave or merging the wave managers.
- Save-schema migrations or key renames; `volSound`/`pq` stay strings.
- TS strict mode or wholesale deletion of the `any` index-signature shims (shrink incrementally instead).
- Splitting `unit-render.js` into per-visual modules — no bundler means extra HTTP requests, and `vis` strings are feature flags with no clean seam.

---

## 5. Execution checklist (for the implementing agent)

Work top to bottom. **Stop and report if any gate fails.** Never proceed past a red gate.

**Setup (once):**
- [ ] `git checkout main && git tag v4.4.x-pre-refactor` (or tag the release commit) and push the tag
- [ ] `npm install`; run `npm run typecheck`; record baseline error count (expect 0)
- [ ] Write `tools/smoke.mjs` + `tools/fixtures/{main-save,meta,achievements}.json` per §0.3 (remember: `setSpeed(2)`, not 3; fixture `volSound`/`volMusic`/`pq` are strings)
- [ ] Run smoke twice on untouched baseline — must pass both times deterministically
- [ ] Write `docs/QA-CHECKLIST.md` per §0.4
- [ ] Commit Phase 0 on branch `refactor/phase-0`; get it merged before touching source

**Per-item loop (repeat for each item, in priority order from §4):**
- [ ] New branch `refactor/phase-N`, one item per commit
- [ ] Make the change as pure code motion / literal-for-literal substitution per its §3 spec
- [ ] Self-review the diff against the item's "Approach" — check for accidental `<`/`<=` flips, reordered iteration, renamed keys, stringified numbers
- [ ] `npm run typecheck` — error count ≤ baseline
- [ ] `npm run smoke` — green, including the save-fixture byte-compat assertions
- [ ] For render-touching items (1.5, 3.5, 3.6): screenshot pixel-diff vs `tools/baseline/`
- [ ] Run the item's specific manual QA steps (listed per item in §3)
- [ ] Commit with a message naming the item number (e.g. `refactor(2.2): spell behavior registry — no behavior change`)

**Item order & item-specific gates:**
- [ ] 2.1 storage helper — gate: fixture test proves all three localStorage strings byte-identical; confirm `Game.saveGame`'s `setItem` still propagates exceptions (no new try/catch there)
- [ ] 1.4 dealDamage/combatSrc — gate: per-callsite field-set identity (ranged path: Projectile still overwrites `siege`/`team`)
- [ ] 1.2 DOM cache then 1.3 write-on-change — gate: grep each converted id for out-of-band writers first
- [ ] 2.2 spell registry — gate: all 4 spells via keyboard AND buttons; Escape/right-click cancel; no cast while paused
- [ ] 3.2 drops + 3.3 projectile defs — gate: scripted shaman kill asserts +2 crystal; all five projectile visuals verified manually
- [ ] 4.1 kind flags — gate: confirm the flag is named `kind` (NOT `isUnit`); siege ×2 vs buildings; formation modifiers player-only
- [ ] 3.1 targeting helpers — gate: 1-D metric + strict `<` tie-break preserved; healer helper stays separate (2-D)
- [ ] 2.4 wave scheduler — gate: delay math byte-identical (campaign `i*700+rand(0,200)` per-group index; endless cumulative `i*500`); no premature victory after meteor-wiping a wave
- [ ] 2.3 input consolidation — gate: mutual-exclusion audit of the two canvas mousedown handlers stated in the commit/PR
- [ ] 4.3 install-mixins — gate: grep confirms no method-name shadowing across the five method objects; dev assert added; boot smoke green
- [ ] 1.1 constants — gate: diff is identifier substitution only
- [ ] 2.5 loop hygiene — gate: four `forEach` calls in original order, NOT index loops; code comment explains why; necromancer wave manual check
- [ ] 4.2 formation param, 4.4 camera viewW, 4.5 CONFIG readonly — gate: typecheck; formation QA; edge-scroll + resize QA
- [ ] 2.6 ordering comments; 3.4 vis validation (boot with zero warnings); optional 1.5 / 3.5 / 3.6 with screenshot diffs
- [ ] Final: full `docs/QA-CHECKLIST.md` pass on the assembled result; `npm run typecheck` + `npm run smoke` one last time

**Hard invariants (check on every single diff):**
- localStorage keys `stickman_dominion_save`, `sd_meta_v1`, `sd_ach_v2` — names and value shapes byte-identical; vol/pq remain strings
- `window.game` global and every inline `onclick="game.…"` entry point keep working (flat method surface on Game)
- No new files loaded by `index.html`; new modules reachable only via the existing `js/main.js` import graph (no build step introduced)
- No gameplay/balance/visual/control change — when in doubt, the diff is wrong, not the game

---

