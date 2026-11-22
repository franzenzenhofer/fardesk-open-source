// What this daemon can do, as names an app checks instead of comparing version numbers (public/docs/VERSIONING.md).
// Names are only ever added: inside one contract major a name is never removed, renamed or reused for something else.
export const FEATURES: readonly string[] = ["chat-image", "self-update", "cold-last-turn", "claude-dialogs", "plan-approval"];
