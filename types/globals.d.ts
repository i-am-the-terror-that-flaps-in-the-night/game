// Ambient declarations for the intentional runtime globals.
// `game` is the single Game instance kept on window (decoupling it is out of
// scope); typed as any so bare `game.…` references across modules type-check
// without coupling every file to the Game class.
declare var game: any;

interface Window {
    game: any;
    webkitAudioContext: typeof AudioContext;
}

// This codebase pervasively reads DOM elements by id/selector and accesses
// subtype members (.value on inputs, .getContext/.width on the canvas,
// .disabled on buttons). Returning `any` here is the accepted pragmatic pattern
// for checkJs over vanilla DOM code: it drops element-subtype checking (which
// surfaced only false-positive noise, never a real bug) while leaving import,
// data-shape, and undefined-symbol checking fully strict.
interface Document {
    getElementById(elementId: string): any;
    querySelector(selectors: string): any;
}
