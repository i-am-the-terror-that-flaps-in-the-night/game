# BALANCE SNAPSHOT — game roster (source of truth for the balance pass)

Target feel: **TACTICAL COUNTERS**. Every unit/enemy should have a clear counter.
Hard to brute-force one unit or spam one spell. Rewards reading the wave + building a comp.

## COMBAT MODEL (js/systems/combat.js)
COUNTER_TABLE[dmgType][armorClass] = multiplier:
- slash:  none 1.2,  light 1.0,  heavy 0.65, shield 0.85
- pierce: none 1.1,  light 1.25, heavy 0.7,  shield 0.5
- blunt:  none 0.85, light 1.0,  heavy 1.35, shield 1.25
- magic:  none 1.0,  light 1.15, heavy 1.25, shield 1.15

Building dmg: siege x2, else blunt x1.2.
vsLarge multiplier applies if target.large. vsFlying if target.flying. armorPierce: heavy/shield treated as light.
Final = max(1, base*mult - target.armor). Formation: aggressive deal 1.15/take 1.1, defensive 0.9/0.85.

## PLAYER UNITS (js/data/units.js) — hp / dmg / range / speed / cooldown(frames) / cost / pop / armor / dmgType / armorClass / special
- militia:   80  /10 /45 /2.2/40 / g10        /1/ armor0 / slash  / none   — "cheap bodies"
- swordsman: 150 /18 /50 /1.8/45 / g25        /1/ armor2 / slash  / shield
- spearman:  120 /22 /75 /1.6/50 / g30        /1/ armor1 / pierce / light  / vsLarge 1.75
- archer:    65  /15 /250/1.4/60 / g35        /1/ armor0 / pierce / none   / ranged, vsFlying 2.0
- crossbow:  80  /35 /280/1.2/90 / g50        /1/ armor2 / pierce / light  / ranged, pierce3, armorPierce, vsFlying 2.0
- cleric:    90  /6  /140/1.3/80 / g60        /1/ armor0 / magic  / none   / heal 40 / healRange 180 / healCd 90
- knight:    280 /44 /55 /3.4/48 / g95 i14    /2/ armor5 / slash  / heavy  / large, charge
- mage:      75  /58 /220/1.1/100/ g100 c12   /1/ armor0 / magic  / none   / ranged, aoe80, vsFlying 2.0
- catapult:  200 /11 /480/0.85/6 / g160 i28   /3/ armor3 / blunt  / heavy  / large, ranged, aoe120, vsLarge 1.5  ← COOLDOWN 6 = machine-gun
- paladin:   320 /50 /52 /2.0/45 / g140 c20   /2/ armor6 / blunt  / heavy  / heal18/healRange160/healCd120

## ENEMIES (js/data/enemies.js) — hp/dmg/range/speed/cooldown/bounty/armor/dmgType/armorClass/special
- rabble:      50  /8 /45 /1.6/50 /b5   / a0 / slash  / none
- marauder:    110 /15/50 /1.8/55 /b12  / a1 / slash  / light   / drops iron1
- berserker:   90  /28/45 /3.0/40 /b18  / a0 / slash  / none    / drops iron2 (fast backline diver)
- shieldman:   220 /12/45 /1.1/70 /b22  / a6 / blunt  / shield  / drops iron4
- archer(E):   55  /14/230/1.3/70 /b15  / a0 / pierce / none
- shaman:      100 /10/130/1.2/90 /b35  / a0 / magic  / none    / heal30/healRange160/healCd100 / drops crystal2
- ogre:        550 /45/65 /0.9/90 /b90  / a4 / blunt  / heavy   / large, aoe60 / drops iron10
- harpy:       130 /20/50 /2.4/55 /b40  / a0 / pierce / none    / flying / drops crystal3
- halberdier:  180 /19/50 /1.3/55 /b28  / a4 / pierce / shield  / drops iron5
- necromancer: 160 /20/240/1.1/120/b60  / a2 / magic  / light   / raises skeletons / drops crystal5
- skeleton:    45  /10/40 /1.5/60 /b2   / a0 / slash  / none    (summoned)
- dragon:      2200/70/160/2.0/70 /b600 / a8 / magic  / heavy   / large, flying, aoe90, BOSS / drops crystal25

## SPELLS (js/data/spells.js) — cost is MANA
- meteor:    cost 50, radius 150, damage 350          (KeyZ)
- blizzard:  cost 40, radius 220, DOT 12/tick (spell-behaviors.js:67), freeze (KeyX)
- heal:      cost 30, radius 200, heal 200            (KeyC)
- lightning: cost 45, chains 6, damage 210 w/ slow falloff (KeyV)

MANA: MAX_MANA 100, MANA_REGEN 0.05/frame (config.js). At 60fps = 3 mana/sec.
→ meteor affordable every ~17s, heal every ~10s. Obelisk adds income.mana 0.05 each.
Upgrade `mana` gives +50% regen. `magic_damage` upgrade scales all spell damage.

## BUILDINGS (js/data/buildings.js)
- castle: hp2000, dmg8, range160, flyRange460, cd7, magic, aoe40, vsFlying 3.0, income g1/i0.5/c0.85
- tower:  hp350, dmg18, range350, cd40
- forge:  +25% melee dmg per forge (FORGE_STEP 0.25). archery: crossbow +20% dmg/+15% range.

## WAVE SCALING (js/systems/waves.js:127)
diff = 1 + wave*0.15 → applied to enemy maxHp AND dmg (game-economy.js:147-148).
So wave 10 enemies have 2.5x hp+dmg. difficultyMult stacks on top.

## KNOWN PAIN POINTS (user: "everything is insane, useless, or spammable")
- Catapult cooldown 6 frames = machine-gun (recent commits d932b4a/3d4ccba show it was pushed hard).
- Spell mana regen may make spells spammable.
- Some units likely useless (militia? cleric dmg 6?), some insane.
