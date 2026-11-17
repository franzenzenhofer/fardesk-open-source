import type { Activity } from "../contract/schema.js";
import type { ToolCall } from "./toolCalls.js";

// How a row's detail is built: a diff of its members, a listing of merged lookups, or an output tail.
export type RowDetail = "diff" | "lookup" | "output" | null;

// One feed row plus what is needed to build its detail on demand (title: "" for text rows).
export type Row = { activity: Activity; title: string; members: ToolCall[]; detail: RowDetail };
