// Shared diary data is JSON-only; Hermes versions without structuredClone
// need this fallback before recurrence and stage planning use the core.
if(typeof globalThis.structuredClone!=='function')globalThis.structuredClone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
