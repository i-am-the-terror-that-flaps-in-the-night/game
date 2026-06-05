# Migration Report — Externalizing `index.html`

**Project:** Stickman Dominion: Warlords (HTML5 canvas RTS)
**Branch:** `refactor/externalize-assets`
**Date:** 2026-06-05
**Goal:** Split the ~7,000-line single-file `index.html` into a clean multi-file
structure **without changing any behavior or business logic.**

---

## 1. Summary

`index.html` previously contained everything inline: ~1,015 lines of CSS in one
`<style>` block, ~835 lines of HTML body, and ~5,092 lines of JavaScript in one
classic `<script>` block. It has been split into:

- **3 CSS files** (`css/`) linked from `<head>`
- **8 JavaScript files** (`js/`) loaded as ordered classic `<script src>` before `</body>`
- **1 SVG sprite** (`assets/icons/sprite.svg`) holding the 5 resource-bar icons
- **`index.html` shrank from 6,956 → 812 lines** (markup + links + script tags only)

The transformation is a **verbatim relocation**: every CSS rule and every line of
JavaScript was *moved*, not rewritten. The only edited markup is the 5 resource
icons (now `<use>` references) and the `<style>`/`<script>` → `<link>`/`<script src>`
swap. **No game logic was touched.**

---

## 2. The core architectural decision: ordered **classic** scripts (not ES modules)

The whole UI is glued to a **single global symbol**, `game` (`const game = new Game()`).
All ~63 inline `on*=` handlers are either `game.method(...)`,
`document.getElementById('x').classList.add('hidden')`, or `this.style…`. There are
**zero** standalone global functions and **zero** `window.x =` assignments.

Two facts drove the design:

1. **ES modules / IIFE wrappers would break everything.** Module-scoped bindings are
   invisible to inline `on*=` handlers, so converting to `type="module"` would break
   all 63 handlers with `ReferenceError`. → **Classic scripts only.**

2. **Top-level `const`/`class` are shared across classic `<script>` files.** A common
   misconception is that a top-level `const`/`class` in one classic script file is
   invisible to another. In fact, classic scripts on a page share **one global lexical
   environment**, so `const`/`class` declared in `data.js` are visible to `game.js`,
   `main.js`, *and* to inline `on*=` handlers. This was **verified empirically in
   headless Chrome** before committing to the split (a 2nd script file and an inline
   `onclick` both successfully read a `const`/`class` defined in a 1st script file).

Because of (2), the single `<script>` could be split into **8 ordered classic-script
files** with **zero logic changes** — the modular structure was achieved as a pure
sequential cut, exactly like the CSS.

> **Trade-off accepted:** load order is now a maintained invariant (see §6). This is
> the price of modular files without a build step or a logic rewrite.

---

## 3. Files created

### CSS (`css/`) — contiguous sequential cut of the original `<style>` (orig lines 11–1024)

| File | Orig lines | Contents | Why it exists |
|---|---|---|---|
| `css/main.css` | 11–72 | `@import` (Google Fonts) · `:root` theme vars · global reset · `body` · `#gameCanvas` · `.ui-layer/.ui-element` | Tokens + base layout. Loaded **first** so every `var(--*)` resolves; the `@import` is legally required to be the first statement. |
| `css/components.css` | 73–764 | `.glass-panel`, top bar, bottom bar, `.btn` family, time controls, side panel, castle health, wave info, minimap, overlays, base `.menu-btn`, tooltip, notifications, tech tree, settings, targeting, scrollbar, "NEW ADDITIONS" (formation/diff/achievements) | All reusable widget styling, in original source order. |
| `css/utilities.css` | 765–1024 | The entire responsive `@media` system (1200/1024/768px) **then** the "HOME SCREEN POLISH" block (menu bg, embers, title, dividers, redeclared `.menu-btn`, version badge) | Loaded **last** so its overrides win at equal specificity — exactly the original behavior. |

### JavaScript (`js/`) — contiguous sequential cut of the original `<script>` (orig lines 1863–6953), dependency-ordered

| File | Orig lines | Contents |
|---|---|---|
| `js/data.js` | 1863–2719 | `CONFIG` + all data tables: `TEAMS, RESOURCES, SPELLS, UNIT_TYPES, META_STATS/MAX_RANK/COST, ENEMY_TYPES, BUILDING_TYPES, TECH_TREE, LEVELS` |
| `js/utils.js` | 2720–2786 | Helpers: `rand, randInt, clamp, dist, lerp, hexToRgb, mixRgb, toRgb, toRgba, mixCol, shade, rgba, ik2, formatTime` |
| `js/systems.js` | 2787–3455 | `AudioEngine, DecalSystem, ParticleSystem, EffectSystem, WeatherSystem, Projectile` |
| `js/entities.js` | 3456–4883 | `Entity` → `Building` → `Unit` (inheritance chain) |
| `js/spells.js` | 4884–5137 | `Camera, SpellManager` |
| `js/game.js` | 5138–6727 | `Game` (main orchestrator) |
| `js/waves.js` | 6728–6928 | `WaveManager, EndlessWave, ACHIEVEMENTS, AchievementSystem` |
| `js/main.js` | 6929–6953 | Bootstrap: `const game = new Game()`, `game.achievements = …`, `spawnEmbers()` IIFE — **must load last** |

### Assets

| File | Contents |
|---|---|
| `assets/icons/sprite.svg` | 5 `<symbol>`s (`icon-gold/iron/crystal/mana/pop`) for the top-bar resource icons. Each keeps `stroke="currentColor"` so it inherits the per-icon `color: var(--…)`. |

### Docs

| File | Contents |
|---|---|
| `docs/migration-report.md` | This document. |

---

## 4. `index.html` changes (the only edited file)

1. `<style>…</style>` (orig 10–1025) → three `<link rel="stylesheet">` in `<head>`,
   in load order `main` → `components` → `utilities`.
2. Inline `<script>…</script>` (orig 1862–6954) → eight `<script src>` immediately
   before `</body>`, in dependency order ending with `js/main.js`. Classic scripts,
   **no `defer`/`async`/`type=module`** (the `Game` constructor synchronously queries
   the DOM, so timing must be unchanged).
3. The 5 inline resource-icon `<svg>…</svg>` blocks →
   `<svg viewBox="0 0 24 24"><use href="assets/icons/sprite.svg#icon-…"/></svg>`,
   kept inside their `<span style="color: var(--…)">` so `currentColor` still applies.

The HTML body is otherwise byte-for-byte unchanged (including the in-progress Armory
feature present in the baseline commit).

---

## 5. Verification performed

### Byte-identity proof (mechanical, strongest)
The split is a pure relocation, so concatenating the pieces in load order must equal
the original block:

- `cat css/main.css css/components.css css/utilities.css` **==** original `<style>` body → empty diff ✅
- `cat js/data.js … js/main.js` **==** original `<script>` body → empty diff ✅

This proves the CSS cascade and JS evaluation are unchanged regardless of behavior
nuance.

### Live browser test (headless Chrome, served over HTTP)
| Check | Result |
|---|---|
| Console exceptions | **0** ✅ |
| Network failures | **0** (only an unrelated `favicon.ico` 404) ✅ |
| `game` / `Game` / `Entity` / `Unit` global | resolved ✅ |
| `rand` / `clamp` / `dist` / `UNIT_TYPES` / `LEVELS` global | resolved ✅ |
| inline-handler methods `game.buyUnit/buyMeta/buyTech/setSpeed` | resolved ✅ |
| Main menu | visible, **38 embers**, title font = `"Cinzel Decorative"` ✅ |
| Start a campaign level (`startCampaignWithDiff(1.0)`) | `ok`; topBar visible; 2 buildings; running ✅ |
| `game.buyUnit('militia')` | units 0 → 1 ✅ |
| Resource icon color | `rgb(251,191,36)` = `--gold` (sprite `currentColor` preserved) ✅ |
| Mobile render (760px) | `@media` + `.menu-btn` polish cascade intact ✅ |

---

## 6. Risks & invariants to preserve (READ BEFORE EDITING)

1. **Do NOT add `type="module"`, `defer`, or `async` to the JS `<script>` tags.**
   `type="module"` hides `game` from inline handlers (breaks all 63);
   `defer`/`async` change the DOM-at-construct timing (the `Game` constructor
   synchronously queries `#gameCanvas`/`#minimap`).
2. **Do NOT reorder the JS `<script>` tags.** `main.js` must be last (it runs
   `new Game()`); `entities.js` must precede anything that subclasses `Entity`
   (it's already first among the class files). Cross-file references inside class
   *methods* resolve at call time, so only `extends` and the final bootstrap impose
   hard order — but keep the given order to stay safe.
3. **Do NOT reorder the CSS `<link>` tags**, and keep `@import` the first line of
   `main.css`. `utilities.css` must load last (its `@media` + polish overrides win
   only by source order). `.menu-btn` is declared three times (components base →
   `@media` → polish) and relies on this order.
4. **Do NOT rename `game` or any `game.*` method** invoked by a handler — including
   `buyMeta`/`buyTech`, which are emitted inside JS-generated `innerHTML`.
5. **Serve over HTTP.** External `<use href="…sprite.svg#…">` does not resolve over
   `file://` in most browsers — over `file://` the 5 resource icons would not render
   (everything else, including CSS/JS, still works). Use any static server, e.g.
   `python3 -m http.server`.
6. **Do NOT normalize the inline `style` widths** in the body. Two responsive rules
   use attribute selectors `.glass-panel[style*="width:850px"]` / `[style*="width:750px"]`
   that match the literal inline width strings.

---

## 7. Phase 4 audit findings

- **Broken selectors:** none. CSS is byte-identical to the original; all JS-toggled
  state classes (`.hidden, .active, .active-spell, .auto-queued, .boss-wave, .owned,
  .unlocked, .ach-locked, .easy/.normal/.hard/.brutal`) are unchanged.
- **Missing event listeners:** none. All 18 `addEventListener` calls and all inline
  handlers are byte-identical and verified resolving.
- **Missing imports:** N/A (no module system; all globals resolve across files — verified).
- **Broken paths:** none. All 12 external files exist; 5 sprite symbols ↔ 5 `<use>`
  refs match exactly; 0 network failures.
- **Duplicate code:** none introduced (a pure cut never duplicates a declaration).
  See pre-existing duplicate note in §9.
- **Unused code (flagged, NOT removed — "assume every feature is important"):**
  - `RESOURCES.START_GOLD` (=150): no read path found (gold is set via `reset(g)`
    argument). High confidence unused; kept.
  - `SPELLS.*.duration`: no `.duration` read found. Kept (config knob).
  - `--iron`/`--crystal`/`--pop` CSS vars: **used** via inline `style="color: var(--…)"`
    in the body — *not* dead. Kept.
- **Potential regressions:** only the `file://` icon-rendering caveat (§6.5),
  documented and acceptable for an HTTP-served app.

---

## 8. Pre-existing issues left untouched (out of scope — behavior preserved)

These existed before the refactor and were deliberately **not** changed:
- `index.html` lint warnings: `-webkit-background-clip` used without the standard
  `background-clip` (gradient text titles). Cosmetic Safari/standard-property warning.
- `CONFIG.GROUND_Y` computed once at parse time (then mutated in `resize()`).
- Blizzard damage not scaled by `magic_damage`.
- Per-frame `getElementById('particleQuality')` reads in the render path.
- Spell-cursor hex→rgba conversion no-op.
- No teardown of the `SpellManager` keydown listener.

## 9. Remaining technical debt

- **`tmp_script.js`** (root, git-tracked, ~176 KB): a **stale, older, shorter
  (4,071 vs 5,092 lines) copy** of the game script with the same `STICKMAN DOMINION 3.1`
  header. It is **not** referenced by `index.html` and is not part of the live app.
  Recommend deleting it (left in place pending owner confirmation).
- **12-space indentation** carried into the extracted files (preserved for the
  byte-identity guarantee). A follow-up could dedent uniformly — but be careful: the
  JS contains template literals that build HTML, so re-indentation must be verified
  not to alter generated markup.

## 10. Recommended next improvements (each is opt-in, behavior-affecting)

1. **True JS modularization** (`js/utils/`, `js/components/`, `js/features/` with
   ES modules): requires either `window.game = game` + explicit exports, or wiring
   handlers via `addEventListener` instead of inline `on*=`. This is the only way to
   subdivide further and would let you drop the load-order invariant — but it is a
   logic change and should be its own reviewed PR.
2. **Fix the pre-existing bugs** in §8 (especially `CONFIG.GROUND_Y` on resize and the
   per-frame DOM reads) in a dedicated branch.
3. **Add a tiny launcher note** (or `npm start` → `http.server`) so contributors run
   over HTTP and never hit the `file://` icon caveat.
4. **Remove `tmp_script.js`** once confirmed obsolete.

---

## 11. How to run

```sh
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```
Opening `index.html` directly via `file://` mostly works but the 5 resource icons
won't render (see §6.5).
