export const meta = {
  name: 'balance-synth',
  description: 'Synthesize the recovered analyst findings into one coherent tactical-counter edit set, then adversarially check it',
  phases: [
    { title: 'Synthesize', detail: 'merge 35 findings into one non-conflicting edit set' },
    { title: 'Adversarial-check', detail: 'skeptic tries to break the edit set' },
  ],
}

const SNAP = `/private/tmp/claude-501/-Users-sachingupta-Developer-game/6f6ac087-11af-4975-84cf-3d8f7b6ef35b/scratchpad/balance-snapshot.md`
const FINDINGS = `/private/tmp/claude-501/-Users-sachingupta-Developer-game/6f6ac087-11af-4975-84cf-3d8f7b6ef35b/scratchpad/analyst-findings.json`

phase('Synthesize')
const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'exact repo path e.g. js/data/units.js, js/config.js, js/systems/spell-behaviors.js' },
          target: { type: 'string', description: 'unit/enemy/spell/building/constant' },
          field: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          kind: { type: 'string', enum: ['data-number', 'code-change'], description: 'data-number = simple field value edit; code-change = needs logic edit (e.g. route spells through dealDamage, add per-spell cooldown, implement freeze)' },
          why: { type: 'string' },
          priority: { type: 'string', enum: ['core', 'nice-to-have'], description: 'core = fixes a real insane/useless/spammable case; nice-to-have = polish' },
        },
        required: ['file', 'target', 'field', 'from', 'to', 'kind', 'why', 'priority'],
      },
    },
    summary: { type: 'string', description: 'the philosophy of the pass in 3-4 sentences' },
  },
  required: ['edits', 'summary'],
}

const synth = await agent(
  `You are the lead game designer. Merge these balance-analyst findings into ONE coherent, non-conflicting edit set for a TACTICAL-COUNTERS feel (every unit/enemy/spell has a clear counter; nothing brute-forceable or spammable).

Read ${SNAP} for the full current model and numbers. Read ${FINDINGS} for the 35 analyst findings across 5 subsystems (units, enemies, spells, economy, buildings) — each with exact from→to proposals and reasoning.

Produce the final edit set. Rules:
- Every edit must map to a REAL field in a REAL file. Files available: js/data/units.js, js/data/enemies.js, js/data/spells.js, js/data/buildings.js, js/data/heroes.js, js/data/tech.js, js/config.js (MANA_REGEN/MAX_MANA), js/systems/spell-behaviors.js (spell damage routing + freeze), js/systems/spell-manager.js (per-spell cooldown gate), js/game/game-economy.js (unitCost ramp, mine cost ramp), js/game/game.js (income multiplier application).
- Classify each edit: kind='data-number' (a plain value change in a data file — safe, mechanical) vs kind='code-change' (needs logic: route spell dmg through dealDamage, add per-spell cooldowns, implement blizzard freeze, extend buildCost ramp to more building types, apply lvlM to iron/crystal income).
- Classify priority: 'core' (fixes a genuine insane/useless/spammable/no-counter case) vs 'nice-to-have' (polish, desc fixes, optional bounty tweaks).
- Resolve conflicts: several analysts touch catapult, obelisk, spells. Pick ONE value per field and justify. Note the catapult cd is agreed 6→~30-36; the mine-iron and unitCost-ramp both address economy spam — keep both only if they don't overcorrect together.
- Keep the COUNTER_TABLE multipliers intact.
- Preserve arcade energy: surgical nudges. Net result: no unit useless, none insane, no spell spammable, every enemy answerable, spells become clutch tools with cadence + armor-awareness.
- Think second-order: nerfing catapult must leave an ogre/shieldwall answer (spearman/mage remain); spell cost hikes must leave spells usable; economy ramps must not starve comp-building.
Return the structured final edit set, core edits first.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA, effort: 'high' })

phase('Adversarial-check')
const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ship', 'revise'] },
    newDegeneracies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          edit: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'concrete adjusted from→to' },
        },
        required: ['edit', 'problem', 'fix'],
      },
    },
    missingCounters: { type: 'array', items: { type: 'string' } },
    adjustedEdits: {
      type: 'array',
      description: 'any specific from→to overrides the applier should use instead of the synth value',
      items: {
        type: 'object',
        properties: {
          target: { type: 'string' }, field: { type: 'string' }, to: { type: 'string' }, why: { type: 'string' },
        },
        required: ['target', 'field', 'to', 'why'],
      },
    },
  },
  required: ['verdict', 'newDegeneracies', 'missingCounters', 'adjustedEdits'],
}

const check = await agent(
  `You are a skeptical balance QA. Read ${SNAP}. Here is the proposed final balance edit set:

${JSON.stringify(synth, null, 2)}

Try to BREAK it. For each edit, apply it mentally against the counter table + roster + wave scaling (diff=1+wave*0.15 on enemy hp AND dmg):
- Does any nerf leave a threat (ogre, shieldwall, dragon, necro-skeletons, harpy, berserker) with NO player answer?
- Does any buff/cost-cut create a new insane or spammable unit/spell/building?
- Do combined economy edits (mine iron nerf + unitCost ramp + catapult iron hike) overcorrect into starvation?
- Do spell edits (cooldowns + armor routing + cost hikes) overcorrect into spells being useless?
Report concrete fixes (exact from→to) for anything you find, in adjustedEdits. If clean, verdict 'ship' with empty arrays.`,
  { label: 'adversarial-check', phase: 'Adversarial-check', schema: CHECK_SCHEMA, effort: 'high' })

return { synth, check }
