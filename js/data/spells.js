// --- DEFINITIONS ---
export const SPELLS = {
    meteor: {
        name: "Meteor Strike",
        cost: 50,
        radius: 150,
        damage: 350,
        color: "#f97316",
        desc: "Calls down a devastating meteor.",
    },
    blizzard: {
        name: "Blizzard",
        cost: 40,
        radius: 220,
        duration: 300,
        color: "#38bdf8",
        desc: "Freezes enemies and deals DOT.",
    },
    heal: {
        name: "Holy Light",
        cost: 30,
        radius: 200,
        heal: 200,
        color: "#fde047",
        desc: "Instantly heals allied units and buildings in area.",
    },
    lightning: {
        name: "Chain Lightning",
        cost: 45,
        chains: 4,
        damage: 120,
        color: "#38bdf8",
        desc: "Arcs through up to 4 enemies, dealing decreasing damage.",
    },
};
