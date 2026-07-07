// Module augmentation (the top-level `export {}` makes this file a module, so
// the `declare module` blocks AUGMENT the existing modules rather than declare
// new ones). The Game/Unit/Building/Entity classes gain methods and fields
// dynamically — Game/Unit via Object.assign(*.prototype, …) mixins, and
// instance fields assigned throughout. Enumerating them statically is the
// God-object typing problem that only the out-of-scope `game`-decoupling would
// remove; until then a permissive index signature lets intra-class `this.…`
// access type-check while cross-file imports and the data layer stay strict.
export {};

declare module "../js/game/game.js" {
    interface Game { [key: string]: any; }
}
declare module "../js/entities/unit.js" {
    interface Unit { [key: string]: any; }
}
declare module "../js/entities/building.js" {
    interface Building { [key: string]: any; }
}
declare module "../js/entities/entity.js" {
    interface Entity { [key: string]: any; }
}
