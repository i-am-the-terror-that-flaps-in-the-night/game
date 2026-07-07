# Manual QA Checklist

Run this after each refactoring phase, in a real browser (`npm run serve` →
`http://localhost:8000`). It covers what the headless smoke test
(`npm run smoke`) cannot: visuals, audio, and feel. Nothing here should change
between phases — this is a behavior-preservation checklist, not a feature test.

## Boot & menu
- [ ] Page loads to the home screen; title, data-mote embers, and menu buttons render
- [ ] "Campaign Mode" button reads "Resume Campaign (N)" if progress was saved
- [ ] Settings overlay opens; sound/music/particle-quality sliders present
- [ ] Achievements and War Council panels open and render their grids

## Campaign
- [ ] Start campaign → difficulty overlay appears → pick a difficulty → level 1 loads
- [ ] Region name notification shows; castle and starting mine are present
- [ ] Recruit each unlocked unit (Militia, Archer); cost/disabled states update
- [ ] Build a Mine, Tower, and an unlocker (Barracks) — placement packs left→right
- [ ] Building an unlocker unlocks its units in the action bar
- [ ] Cast all four spells via keys **Z/X/C/V** and via the spell buttons
- [ ] Right-click and **Escape** both cancel a pending spell target
- [ ] Cycle formations (Defensive / Standard / Aggressive); selection highlights
- [ ] "Call Wave" summons the next wave early; wave-incoming notification fires
- [ ] Win level 1 → victory screen shows kills, bounty, region reward, Renown

## Endless
- [ ] Start Endless → survive several waves; wave theme + power notification each wave
- [ ] Boss wave (every 5th) triggers the boss notification and screen shake
- [ ] Die (let the castle fall) → game-over screen shows waves survived + best wave

## Persistence (reload the page between checks)
- [ ] After a campaign win, reload → "Resume Campaign (N)" reflects new progress
- [ ] After an endless run, reload → best wave persisted
- [ ] War Council: unlock a unit with Renown, reload → still unlocked
- [ ] Sound/music/particle-quality settings persist across reload

## Controls & display
- [ ] Edge-scroll (mouse to screen edges) pans the camera to both world ends
- [ ] Pause (speed 0) and speed 1×/2× toggle; active button highlights
- [ ] Resize the window mid-game — HUD and canvas reflow, game keeps running
- [ ] Minimap tracks units/enemies/buildings
- [ ] No console errors in DevTools during any of the above
