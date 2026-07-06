# Stickman Dominion: Warlords

A browser RTS/defense game. Static site — open `index.html` or deploy with Cloudflare Workers (`wrangler.jsonc` serves the repo root).

## Project structure

```
index.html            Page markup (HUD, menus, overlays) + stylesheet/script includes
css/
  base.css            Fonts, CSS variables, resets, canvas
  hud.css             In-game HUD: resource bar, action bar, side panels, minimap
  menus.css           Overlays & menus, tooltips, notifications, tech tree, settings
  components.css      Small widgets: vignette, formation bar, difficulty, achievements
  responsive.css      Mobile/tablet breakpoints
  home.css            Home screen: embers, title, menu buttons
js/
  config.js           CONFIG, TEAMS, RESOURCES constants
  combat.js           Counter system: damage types × armor classes, formation mods, wave hints
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

All scripts are classic (non-module) scripts sharing one global scope, loaded
in dependency order by `index.html` — data first, then systems, entities, the
`Game` class and its prototype mixins, and finally `main.js` which instantiates
the game. The `game/*.js` and `entities/unit-render.js` files attach methods
via `Object.assign(X.prototype, {...})`, so they must load after the file that
defines the class.
