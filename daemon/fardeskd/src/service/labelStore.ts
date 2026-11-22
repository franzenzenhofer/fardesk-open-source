// The user's own name, colour and pin per session. Strict JSON state file, same helper as the mute store.
import { z } from "zod";
import { readJsonState, writeJsonState } from "../core/jsonState.js";
import { sessionLabelSchema } from "../contract/schema.js";
import type { LabelRequest, SessionLabel } from "../contract/schema.js";

// A label stored before chat images existed has no image key: it reads as null and is written back with it.
const storedLabelSchema = sessionLabelSchema.extend({ image: sessionLabelSchema.shape.image.default(null) });
const labelFileSchema = z.strictObject({ labels: z.record(z.string().min(1), storedLabelSchema) });

export const NO_LABEL: SessionLabel = { name: null, color: null, pinned: false, image: null };

export type LabelStore = {
  get(sessionId: string): SessionLabel;
  /** Applies a patch: only the keys present change; an empty name clears the custom name. */
  patch(sessionId: string, request: LabelRequest): SessionLabel;
  /** Sets or clears (null) the chat image hash; the other label parts stay. */
  setImage(sessionId: string, image: string | null): SessionLabel;
};

const isEmpty = (label: SessionLabel): boolean => label.name === null && label.color === null && !label.pinned && label.image === null;

function applyPatch(current: SessionLabel, request: LabelRequest): SessionLabel {
  const name = request.name === undefined ? current.name : (request.name?.trim() || null);
  return {
    name,
    color: request.color === undefined ? current.color : request.color,
    pinned: request.pinned ?? current.pinned,
    image: current.image,
  };
}

export function createLabelStore(path: string): LabelStore {
  let labels: Record<string, SessionLabel> = readJsonState(path, labelFileSchema, "label store", { labels: {} }).labels;
  const save = (sessionId: string, next: SessionLabel): SessionLabel => {
    const others = Object.fromEntries(Object.entries(labels).filter(([id]) => id !== sessionId));
    const updated = isEmpty(next) ? others : { ...others, [sessionId]: next };
    writeJsonState(path, { labels: Object.fromEntries(Object.entries(updated).toSorted(([a], [b]) => a.localeCompare(b))) });
    labels = updated;
    return next;
  };
  const current = (sessionId: string): SessionLabel => labels[sessionId] ?? NO_LABEL;
  return {
    get: current,
    patch: (sessionId, request) => save(sessionId, applyPatch(current(sessionId), request)),
    setImage: (sessionId, image) => save(sessionId, { ...current(sessionId), image }),
  };
}
