# Stickman Dominion: Warlords

A browser RTS/defense game. Static site — open `index.html` or deploy with Cloudflare Workers (`wrangler.jsonc` serves the repo root).

## Project structure

```
index.html            Page markup (HUD, menus, overlays) + stylesheet/script includes
css/
  base.css            Fonts + the full design-token layer (:root), resets, canvas
  hud.css             In-game HUD: holo-panels, resource bar, tabbed action bar, minimap
  menus.css           Overlays & menus, tooltips, notifications, tech tree, dialog classes
  components.css      Small widgets: vignette, formation bar, difficulty, achievements
  responsive.css      Mobile/tablet breakpoints (target the .dialog--* classes)
  home.css            Home screen: data-motes, title, menu buttons
js/
  config.js           CONFIG, TEAMS, RESOURCES constants
  combat.js           Counter system: damage types × armor classes, formation mods, wave hints
  meta.js             MetaProgression: Renown currency + permanent unit unlocks (War Council)
  data/               Pure data definitions (balance lives here)
    spells.js         SPELLS
    units.js          UNIT_TYPES (player roster)
    enemies.js        ENEMY_TYPES
    buildings.js      BUILDING_TYPES
    tech.js           TECH_TREE
    levels.js         LEVELS (campaign definitions)
  utils.js            Math/color helpers
  audio.js            AudioEngine (WebAudio SFX/music)
  vfx.js              DecalSystem, ParticleSystem, EffectSystem, WeatherSystem
  projectile.js       Projectile physics & rendering
  entities/
    entity.js         Entity base class
    building.js       Building
    unit.js           Unit logic: stats, XP, AI update, combat
    unit-render.js    Unit.draw — stickman rendering (mixed into Unit.prototype)
  camera.js           Camera
  spell-manager.js    SpellManager (targeting & casting)
  game/               The Game class, split by concern
    game.js           Core state, save/load, update loop, victory/defeat
    game-flow.js      Campaign/endless/level flow (mixin)
    game-economy.js   Gold/iron/crystal, recruiting, building, tech (mixin)
    game-input.js     Event binding, spell selection, formations (mixin)
    game-ui.js        Panels, notifications, HUD updates, minimap (mixin)
    game-render.js    Backdrop, foreground, post-FX, frame draw (mixin)
  waves.js            WaveManager, EndlessWave
  achievements.js     ACHIEVEMENTS + AchievementSystem
  main.js             Bootstrap: creates the Game, home-screen embers
```

## Strategy systems

Combat is deterministic — no crits, no dice. Every unit has a damage type
(slash / pierce / blunt / magic) and an armor class (unarmored / light /
heavy / shielded); `js/combat.js` holds the counter table and the single
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

`js/meta.js` (`MetaProgression`, mirrors `AchievementSystem`) adds a
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

All scripts are classic (non-module) scripts sharing one global scope, loaded
in dependency order by `index.html` — data first, then systems, entities, the
`Game` class and its prototype mixins, and finally `main.js` which instantiates
the game. The `game/*.js` and `entities/unit-render.js` files attach methods
via `Object.assign(X.prototype, {...})`, so they must load after the file that
defines the class.
