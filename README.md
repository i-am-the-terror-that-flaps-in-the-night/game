# Stickman Dominion: Warlords

A browser RTS/defense game. Static site — open `index.html` or deploy with Cloudflare Workers (`wrangler.jsonc` serves the repo root).

## Project structure

```
index.html            Page markup (HUD, menus, overlays) + stylesheet/script includes
css/
  base.css            Fonts + the full design-token layer (:root), resets, canvas
  hud.css             In-game HUD: holo-panels, resource bar, tabbed action bar, minimap
  menus.css           Overlays & menus, tooltips, notifications, tech tree, dialog classes
  components.css      Small widgets: formation bar, wave preview, difficulty, achievements
  responsive.css      Mobile/tablet breakpoints (target the .dialog--* classes)
  home.css            Home screen: data-motes, title, menu buttons
js/
  config.js           CONFIG, TEAMS, RESOURCES constants
  utils.js            Math/color helpers + shared UI helpers (cap, btnId, costStr, particleQuality)
  data/               Pure data definitions (balance lives here)
    spells.js         SPELLS
    units.js          UNIT_TYPES (player roster)
    enemies.js        ENEMY_TYPES
    buildings.js      BUILDING_TYPES
    tech.js           TECH_TREE
    levels.js         LEVELS (campaign definitions)
  entities/
    entity.js         Entity base class
    building.js       Building
    unit.js           Unit logic: stats, XP, AI update, combat
    unit-render.js    Unit.draw — stickman rendering (mixed into Unit.prototype)
  systems/            Engine & progression systems (no per-entity or Game state)
    combat.js         Counter system + resolveDamage/defOf (damage×armor, formations, wave hints)
    audio.js          AudioEngine (WebAudio SFX/music)
    vfx.js            DecalSystem, ParticleSystem, EffectSystem, WeatherSystem
    projectile.js     Projectile physics & rendering
    camera.js         Camera
    spell-manager.js  SpellManager (targeting & casting)
    waves.js          WaveManager, EndlessWave
    achievements.js   ACHIEVEMENTS + AchievementSystem
    meta.js           MetaProgression: Renown currency + permanent unit unlocks (War Council)
  game/               The Game class, split by concern
    game.js           Core state, save/load, update loop, victory/defeat
    game-flow.js      Campaign/endless/level flow (mixin)
    game-economy.js   Gold/iron/crystal, recruiting, building, tech (mixin)
    game-input.js     Event binding, entity picking, spell selection, formations (mixin)
    game-ui.js        Panels, notifications, HUD updates, minimap (mixin)
    game-render.js    Backdrop, foreground, post-FX, frame draw (mixin)
  ui/
    action-bar.js     Generates the 18 recruit/build buttons + the roster/hotkey source
  main.js             ES-module entry: renders the action bar, creates the Game
types/                Ambient TS declarations for the type-check gate
  globals.d.ts        `game` global + DOM widening
  augment.d.ts        Permissive index signatures for the mixin-built classes
  data.d.ts           EntityDef / BuildingDef shapes for the data tables
tsconfig.json         checkJs config (`npm run typecheck` → tsc --noEmit)
```

## Modules & tooling

The code is loaded as **ES modules** from a single entry point
(`index.html` has one `<script type="module" src="js/main.js">`); the import
graph resolves load order, so there is no fragile hand-ordered script list.
Each file `import`s exactly the classes/data/utils it uses and `export`s its own
definitions. The one intentional global is the `game` singleton on `window.game`
— inline HTML handlers (`onclick="game.…"`) and entity/system code reference it
by that name; decoupling it further is deliberately out of scope.

`Game` and `Unit` are still assembled from `Object.assign(*.prototype, {…})`
mixins across `game/*.js` and `entities/unit-render.js`; `js/main.js` imports
those modules for their side effects before constructing the game.

**Static analysis:** `npm run typecheck` (`tsc --noEmit` with `checkJs`) covers
the whole codebase — it validates every cross-file import/export and, via the
`EntityDef`/`BuildingDef` typedefs in `types/data.d.ts`, flags a mistyped field
in `js/data/*.js` (e.g. `dmgg` → *"did you mean 'dmg'"*). No build step ships:
the raw modules are what deploy (`.assetsignore` keeps dev-only files out of the
Cloudflare upload).

The **action bar** is generated from `UNIT_TYPES`/`BUILDING_TYPES` by
`js/ui/action-bar.js` rather than hand-written HTML, so unit cost/roster live in
one place; it produces the same button ids/classes/handlers the HUD code
expects.

## Strategy systems

Combat is deterministic — no crits, no dice. Every unit has a damage type
(slash / pierce / blunt / magic) and an armor class (unarmored / light /
heavy / shielded); `js/systems/combat.js` holds the counter table and the single
`resolveDamage()` used by melee, projectiles, and towers. Spamming one unit
is punished twice: waves are themed around armor classes that hard-counter
monocultures, and recruiting the same unit repeatedly costs +18% per living
copy. Advanced units are gated behind buildings each level (Barracks,
Archery Range, Academy, War Forge), mines escalate in price, formations
trade damage dealt for damage taken, and endless mode runs a scripted
five-theme rotation that is previewed — with a counter hint — before each
wave lands.

## Late-campaign relief

Every level ramps two safety nets so the campaign gets *easier* as it goes
without touching the early game: the castle (`js/data/buildings.js`) fires
short-range, armor-agnostic magic bolts whose damage scales with
`1 + level * 0.6` (45 dmg on level 1 up to 234 on level 8), and gold income
gets a `1 + level * 0.22` multiplier (up to 2.54×) applied in the income
loop (`js/game/game.js`) and mirrored in the HUD rate display
(`js/game/game-ui.js`). Both ramps are computed from `this.level` in
`reset()` and floor at their base value in endless mode (`level === -1`).
The castle's range (140) and cooldown are fixed at every level — it only
cleans up whatever reaches the gate, it never snipes across the map.
`Building`'s projectile firing (`js/entities/building.js`) reads
`projectile`/`aoe`/`dmgType` from `BUILDING_TYPES` so any building can be
given an attack; towers are unaffected since they don't set those fields.

## Meta progression

`js/systems/meta.js` (`MetaProgression`, mirrors `AchievementSystem`) adds a
persistent **Renown** currency saved under `sd_meta_v1`. Clearing a campaign
region (`victory()`) and reaching each endless wave (`EndlessWave.update`)
bank Renown immediately. The home-screen **War Council** panel spends it to
**permanently unlock** any of the eight advanced units; unlocks are merged
into the run roster in `reset()` (`meta.applyTo`), so they bypass the
per-level building gate and are available from the start of every campaign
region and endless run. The base Militia + Archer are always free — permanent
unlocks widen the opening roster rather than replace the building system,
which still gates any unit not yet bought.

## UI theme (holographic command-console)

The interface uses a sci-fi cyan/teal "command-console" look built entirely on
a design-token layer in `css/base.css` `:root` — colors, spacing, radius, glow,
shadow, blur, and z-index scales. Two shared surfaces carry most of the theme:
`.glass-panel` (holo-panel: cyan corner brackets, scanlines, neon edge) and
`.btn` (console keys with corner ticks + cyan hover glow). Because the widely
used `--accent`/`--panel-border` tokens and those two classes are referenced
everywhere (including JS template literals), the theme is centrally tunable.
Fonts: Orbitron for display chrome, Share Tech Mono for HUD numerics.

The bottom action bar is decluttered into **Units / Buildings tabs**
(`#unitButtons` / `#buildingButtons` wrappers toggled by `game.setActionTab()`
in `js/game/game-ui.js`). Tabs only toggle a wrapper's `display`, so all 18
buttons stay in the DOM and the per-frame `updateUI()` keeps updating the hidden
group; unit/build hotkeys work regardless of the visible tab. Overlay dialogs
size via `.dialog` / `.dialog--wide` / `.dialog--narrow` classes (tokenized
widths) rather than inline pixel widths, which `responsive.css` targets directly.

(See **Modules & tooling** above for the ES-module loading model that replaced
the old hand-ordered classic-script list.)
