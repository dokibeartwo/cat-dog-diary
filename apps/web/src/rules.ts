// Shared UMD modules are loaded before React; the desktop modules stay unchanged.
const globals=globalThis as any;
export const D=globals.TaskDomain;
export const Diary=globals.DiaryV1;
export const P=globals.Productivity;
export const R=globals.PreviewRuntime;
