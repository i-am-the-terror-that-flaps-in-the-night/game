// --- DEFINITIONS ---
export const SPELLS = {
    meteor: {
        name: "Meteor Strike",
        cost: 50,
        radius: 150,
        damage: 350,
        color: "#f97316",
        key: "KeyZ",
        desc: "Calls down a devastating meteor.",
    },
    blizzard: {
        name: "Blizzard",
        cost: 40,
        radius: 220,
        color: "#38bdf8",
        key: "KeyX",
        desc: "Freezes enemies and deals DOT.",
    },
    heal: {
        name: "Holy Light",
        cost: 30,
        radius: 200,
        heal: 200,
        color: "#fde047",
        key: "KeyC",
        desc: "Instantly heals allied units and buildings in area.",
    },
    lightning: {
        name: "Chain Lightning",
        cost: 45,
        chains: 6,
        damage: 210,
        color: "#7dd3fc",
        key: "KeyV",
        desc: "Arcs through up to 6 enemies — grounded or airborne — dealing heavy magic damage that falls off slowly with each jump.",
    },
};
