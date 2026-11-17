import { permissionModeSchema } from "../contract/schema.js";
import type { PermissionMode } from "../contract/schema.js";

export const BYPASS_PERMISSIONS: PermissionMode = "bypassPermissions";

/** A mode string from a transcript as a contract mode; null when absent or not a mode Claude Code knows. */
export function knownPermissionMode(raw: string | null): PermissionMode | null {
  const parsed = permissionModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
