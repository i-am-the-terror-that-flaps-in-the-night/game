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

All scripts are classic (non-module) scripts sharing one global scope, loaded
in dependency order by `index.html` — data first, then systems, entities, the
`Game` class and its prototype mixins, and finally `main.js` which instantiates
the game. The `game/*.js` and `entities/unit-render.js` files attach methods
via `Object.assign(X.prototype, {...})`, so they must load after the file that
defines the class.
