// Public surface of the transcript module: the ONE place that understands transcript lines.
export { buildDetail } from "./detail.js";
export type { DetailOptions } from "./detail.js";
export { createParseStats, parseLine } from "./lineSchema.js";
export type { ParseStats, TranscriptLine } from "./lineTypes.js";
export { mapActivities } from "./mapper.js";
export type { MapOptions } from "./mapper.js";
export { pageActivities } from "./page.js";
export type { PageOptions } from "./page.js";
export { summarise } from "./summary.js";
export type { TranscriptSummary } from "./summary.js";
export { createTailer } from "./tailer.js";
export type { Tailer, TailerDeps } from "./tailer.js";
