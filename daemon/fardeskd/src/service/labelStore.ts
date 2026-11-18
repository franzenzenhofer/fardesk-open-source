// The user's own name, colour and pin per session. Strict JSON state file, same helper as the mute store.
import { z } from "zod";
import { readJsonState, writeJsonState } from "../core/jsonState.js";
import { sessionLabelSchema } from "../contract/schema.js";
import type { LabelRequest, SessionLabel } from "../contract/schema.js";

const labelFileSchema = z.strictObject({ labels: z.record(z.string().min(1), sessionLabelSchema) });

export const NO_LABEL: SessionLabel = { name: null, color: null, pinned: false };

export type LabelStore = {
  get(sessionId: string): SessionLabel;
  /** Applies a patch: only the keys present change; an empty name clears the custom name. */
  patch(sessionId: string, request: LabelRequest): SessionLabel;
};

const isEmpty = (label: SessionLabel): boolean => label.name === null && label.color === null && !label.pinned;

function applyPatch(current: SessionLabel, request: LabelRequest): SessionLabel {
  const name = request.name === undefined ? current.name : (request.name?.trim() || null);
  return {
    name,
    color: request.color === undefined ? current.color : request.color,
    pinned: request.pinned ?? current.pinned,
  };
}

export function createLabelStore(path: string): LabelStore {
  let labels: Record<string, SessionLabel> = readJsonState(path, labelFileSchema, "label store", { labels: {} }).labels;
  return {
    get: (sessionId): SessionLabel => labels[sessionId] ?? NO_LABEL,
    patch(sessionId, request): SessionLabel {
      const next = applyPatch(labels[sessionId] ?? NO_LABEL, request);
      const others = Object.fromEntries(Object.entries(labels).filter(([id]) => id !== sessionId));
      const updated = isEmpty(next) ? others : { ...others, [sessionId]: next };
      writeJsonState(path, { labels: Object.fromEntries(Object.entries(updated).toSorted(([a], [b]) => a.localeCompare(b))) });
      labels = updated;
      return next;
    },
  };
}
