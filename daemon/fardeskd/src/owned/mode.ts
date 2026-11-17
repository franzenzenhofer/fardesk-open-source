// Which permission mode an owned session runs in, and the one place that refuses bypassPermissions when it is off.
import type { PermissionMode } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";
import { BYPASS_PERMISSIONS } from "../sessions/permissionMode.js";

export type ModeDeps = { permissionMode: PermissionMode; allowBypass: boolean; log: Logger };

/** A new session: the requested mode, else the configured default. Asking for bypassPermissions while it is off is refused. */
export function startMode(deps: ModeDeps, requested: PermissionMode | undefined): PermissionMode {
  const mode = requested ?? deps.permissionMode;
  if (mode === BYPASS_PERMISSIONS && !deps.allowBypass) {
    throw new FardeskError("unsupported", "bypassPermissions is off on this machine: set owned.allowBypass to true in config.json and restart fardeskd");
  }
  return mode;
}

/** A resumed session continues in its last mode; a bypass mode it had before the switch was turned off falls back to the configured default. */
export function resumeMode(deps: ModeDeps, last: PermissionMode | null): PermissionMode {
  if (last === null) return deps.permissionMode;
  if (last === BYPASS_PERMISSIONS && !deps.allowBypass) {
    deps.log.warn("resume_bypass_downgraded", { to: deps.permissionMode });
    return deps.permissionMode;
  }
  return last;
}
