/** @type {Record<string, EntityDef>} */
export const HEROES = {
    voidcaller: {
        name: "Voidcaller",
        hp: 520,                     // tanky bruiser — dives the line and survives
        dmg: 34,                     // hits hard even while charging Singularity
        range: 260,
        speed: 2.6,                  // faster than the army (militia 2.2) — leads the charge
        cooldown: 40,                // basic-attack cadence (frames)
        cost: {},
        pop: 0,
        armor: 4,                    // frontline anchor
        dmgType: "magic",
        armorClass: "light",
        ranged: true,
        projectile: "fireball",      // reuse the fireball visual for his void-bolt
        aoe: 70,                     // basic attacks splash — dangerous vs groups while charging
        pierce: 1,                   // and clip a second enemy in line
        scale: 1.35,                 // visibly larger than a normal unit — reads as a hero
        desc: "An offensive powerhouse. Warps space around him, tearing foes into a collapsing Singularity.",
        visual: "staff",
        color: "#a855f7",
        respawnMs: 60000,            // wall-clock ms; caller converts to frames
        ability: {
            id: "singularity",
            name: "Singularity",
            // No resource cost — Singularity is fuelled by Void Charge, which
            // builds from landing basic hits (more per enemy struck). Cast when
            // the meter is full; charge (not a cooldown) is the gate.
            cost: 0,
            charge: 100,             // charge units required to cast (meter is 0..100)
            chargePerHit: 9,         // gained per basic-attack hit...
            chargePerSplash: 4,      // ...plus this for each extra enemy the splash catches
            cooldown: 0,             // no hard cooldown; charge is the pacing mechanism
            radius: 220,
            damage: 380,
            duration: 180,           // pull phase length in dt-frames
            key: "KeyB",             // Q/E collide with Mine/Tower build hotkeys; B is free
        },
    },
};
