export const LEVELS = [
    {
        name: "The Frontier",
        ground: "#143d26",
        sky: "#0f172a",
        weather: "none",
        terrain: {
            seed: 101,
            rough: 16,
            segments: [
                "rolling",
                "forest",
                "shrine:gold",
                "rolling",
                "hillforest",
                "bridge",
                "rolling",
                "highland",
                "forest",
                "rolling",
            ],
        },
        hazard: null,
        waves: [
            { time: 10, enemies: [{ t: "rabble", c: 6 }] },
            { time: 35, enemies: [{ t: "rabble", c: 10 }] },
            {
                time: 70,
                enemies: [
                    { t: "rabble", c: 12 },
                    { t: "marauder", c: 4 },
                ],
            },
        ],
        startGold: 200,
        reward: 50,
    },
    {
        name: "Bandit Camp",
        ground: "#214a1b",
        sky: "#1e1b4b",
        weather: "none",
        terrain: {
            seed: 202,
            rough: 22,
            segments: [
                "rolling",
                "mud",
                "shrine:gold",
                "pass",
                "forest",
                "highland",
                "ford",
                "hillforest",
                "rolling",
                "pass",
            ],
        },
        hazard: { type: "rockslide", every: [28, 42] },
        waves: [
            { time: 10, enemies: [{ t: "rabble", c: 10 }] },
            {
                time: 40,
                enemies: [
                    { t: "marauder", c: 6 },
                    { t: "rabble", c: 5 },
                ],
            },
            {
                time: 80,
                enemies: [
                    { t: "marauder", c: 10 },
                    { t: "berserker", c: 3 },
                ],
            },
            {
                time: 120,
                enemies: [
                    { t: "rabble", c: 15 },
                    { t: "berserker", c: 6 },
                ],
            },
        ],
        startGold: 250,
        reward: 80,
    },
    {
        name: "Shield Wall",
        ground: "#2b4d1d",
        sky: "#172554",
        weather: "rain",
        terrain: {
            seed: 303,
            rough: 20,
            segments: [
                "forest",
                "bridge",
                "shrine:watch",
                "rolling",
                "pass",
                "hillforest",
                "ford",
                "marsh",
                "highland",
                "bridge",
            ],
        },
        hazard: { type: "lightning", every: [26, 40] },
        waves: [
            { time: 15, enemies: [{ t: "marauder", c: 8 }] },
            {
                time: 50,
                enemies: [
                    { t: "shieldman", c: 6 },
                    { t: "marauder", c: 6 },
                ],
            },
            {
                time: 95,
                enemies: [
                    { t: "shieldman", c: 10 },
                    { t: "halberdier", c: 4 },
                    { t: "archer", c: 5 },
                ],
            },
            {
                time: 140,
                enemies: [
                    { t: "shieldman", c: 12 },
                    { t: "halberdier", c: 6 },
                    { t: "berserker", c: 8 },
                    { t: "archer", c: 8 },
                ],
            },
        ],
        startGold: 280,
        reward: 120,
    },
    {
        name: "Rain of Arrows",
        ground: "#345920",
        sky: "#2e1065",
        weather: "rain",
        terrain: {
            seed: 404,
            rough: 24,
            segments: [
                "hillforest",
                "forest",
                "shrine:watch",
                "ford",
                "marsh",
                "forest",
                "highland",
                "tunnelforest",
                "rolling",
                "forest",
            ],
        },
        hazard: { type: "lightning", every: [22, 34] },
        waves: [
            {
                time: 15,
                enemies: [
                    { t: "archer", c: 8 },
                    { t: "shieldman", c: 3 },
                ],
            },
            {
                time: 50,
                enemies: [
                    { t: "archer", c: 12 },
                    { t: "marauder", c: 10 },
                    { t: "harpy", c: 3 },
                ],
            },
            {
                time: 90,
                enemies: [
                    { t: "archer", c: 18 },
                    { t: "shieldman", c: 10 },
                    { t: "harpy", c: 5 },
                ],
            },
            {
                time: 140,
                enemies: [
                    { t: "archer", c: 25 },
                    { t: "berserker", c: 12 },
                    { t: "marauder", c: 12 },
                    { t: "harpy", c: 6 },
                ],
            },
        ],
        startGold: 320,
        reward: 160,
    },
    {
        name: "Tribal Magic",
        ground: "#2c6213",
        sky: "#022c22",
        weather: "none",
        terrain: {
            seed: 505,
            rough: 26,
            segments: [
                "rolling",
                "tunnelforest",
                "shrine:mana",
                "marsh",
                "hillforest",
                "ford",
                "highland",
                "tunnel",
                "forest",
                "rolling",
            ],
        },
        hazard: { type: "rockslide", every: [26, 38] },
        waves: [
            {
                time: 15,
                enemies: [
                    { t: "shaman", c: 4 },
                    { t: "rabble", c: 15 },
                ],
            },
            {
                time: 55,
                enemies: [
                    { t: "shaman", c: 5 },
                    { t: "marauder", c: 12 },
                ],
            },
            {
                time: 100,
                enemies: [
                    { t: "shaman", c: 6 },
                    { t: "ogre", c: 2 },
                    { t: "shieldman", c: 8 },
                ],
            },
            {
                time: 150,
                enemies: [
                    { t: "shaman", c: 8 },
                    { t: "ogre", c: 3 },
                    { t: "berserker", c: 12 },
                ],
            },
        ],
        startGold: 380,
        reward: 200,
    },
    {
        name: "Ogre March",
        ground: "#45413c",
        sky: "#3b1703",
        weather: "snow",
        terrain: {
            seed: 606,
            rough: 30,
            segments: [
                "snow",
                "highland",
                "tunnel",
                "shrine:gold",
                "pass",
                "snow",
                "hillforest",
                "bridge",
                "pass",
                "snow",
            ],
        },
        hazard: { type: "whiteout", every: [26, 38] },
        waves: [
            {
                time: 20,
                enemies: [
                    { t: "ogre", c: 3 },
                    { t: "rabble", c: 12 },
                ],
            },
            {
                time: 65,
                enemies: [
                    { t: "ogre", c: 4 },
                    { t: "archer", c: 10 },
                    { t: "harpy", c: 4 },
                ],
            },
            {
                time: 110,
                enemies: [
                    { t: "ogre", c: 5 },
                    { t: "berserker", c: 12 },
                    { t: "halberdier", c: 5 },
                ],
            },
            {
                time: 160,
                enemies: [
                    { t: "ogre", c: 8 },
                    { t: "shaman", c: 5 },
                    { t: "shieldman", c: 15 },
                    { t: "halberdier", c: 8 },
                    { t: "harpy", c: 6 },
                ],
            },
        ],
        startGold: 480,
        reward: 250,
    },
    {
        name: "The Horde",
        ground: "#5c280b",
        sky: "#18181b",
        weather: "snow",
        terrain: {
            seed: 707,
            rough: 34,
            segments: [
                "hillforest",
                "bridge",
                "shrine:gold",
                "snow",
                "tunnelforest",
                "ford",
                "shrine:watch",
                "highland",
                "pass",
                "forest",
            ],
        },
        hazard: { type: "whiteout", every: [22, 34] },
        waves: [
            { time: 10, enemies: [{ t: "rabble", c: 30 }] },
            {
                time: 50,
                enemies: [
                    { t: "marauder", c: 25 },
                    { t: "archer", c: 12 },
                ],
            },
            {
                time: 100,
                enemies: [
                    { t: "shieldman", c: 20 },
                    { t: "halberdier", c: 10 },
                    { t: "berserker", c: 20 },
                ],
            },
            {
                time: 160,
                enemies: [
                    { t: "ogre", c: 6 },
                    { t: "necromancer", c: 4 },
                    { t: "archer", c: 18 },
                    { t: "harpy", c: 8 },
                ],
            },
            {
                time: 220,
                enemies: [
                    { t: "necromancer", c: 6 },
                    { t: "ogre", c: 8 },
                    { t: "berserker", c: 25 },
                    { t: "harpy", c: 10 },
                ],
            },
        ],
        startGold: 600,
        reward: 350,
    },
    {
        name: "Dragon Flight",
        ground: "#3b0606",
        sky: "#000000",
        weather: "rain",
        terrain: {
            seed: 808,
            rough: 30,
            segments: [
                "highland",
                "tunnel",
                "shrine:mana",
                "pass",
                "tunnelforest",
                "rolling",
                "shrine:gold",
                "ford",
                "tunnel",
                "highland",
            ],
        },
        hazard: { type: "fireVent", every: [18, 30], vents: [1300, 2100, 2900, 3700, 4600] },
        waves: [
            {
                time: 20,
                enemies: [
                    { t: "dragon", c: 1 },
                    { t: "harpy", c: 6 },
                    { t: "marauder", c: 12 },
                ],
            },
            {
                time: 70,
                enemies: [
                    { t: "dragon", c: 1 },
                    { t: "harpy", c: 8 },
                    { t: "ogre", c: 6 },
                    { t: "shaman", c: 6 },
                ],
            },
            {
                time: 130,
                enemies: [
                    { t: "dragon", c: 2 },
                    { t: "harpy", c: 10 },
                    { t: "necromancer", c: 5 },
                    { t: "shieldman", c: 20 },
                    { t: "halberdier", c: 10 },
                ],
            },
            {
                time: 200,
                enemies: [
                    { t: "dragon", c: 4 },
                    { t: "harpy", c: 12 },
                    { t: "ogre", c: 12 },
                    { t: "necromancer", c: 8 },
                    { t: "berserker", c: 30 },
                ],
            },
            {
                // Campaign finale: the dragon storm breaks and Rustmaw, the
                // Hollow Engine, tears onto the field as the last stand.
                time: 265,
                enemies: [{ t: "ogre", c: 3 }],
                boss: true,
            },
        ],
        startGold: 900,
        reward: 600,
    },
];
