// set-password, devices and revoke: through the running daemon when there is one, else straight on the files.
import { join } from "node:path";
import { createDeviceRegistry, REGISTRY_FILE } from "../auth/deviceRegistry.js";
import type { DeviceRegistry } from "../auth/deviceRegistry.js";
import { newMasterToken } from "../auth/masterToken.js";
import { hashPassword } from "../auth/password.js";
import { loadConfig, updateConfigFile, writePasswordHash } from "../config/config.js";
import { MIN_PASSWORD_LENGTH, authDeviceListSchema, okResultSchema, revokeResultSchema } from "../contract/schema.js";
import type { AuthDevice } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { callDaemon } from "./daemonClient.js";
import { EXIT_OK, EXIT_USAGE } from "./types.js";
import type { CommandContext } from "./types.js";

const NO_DAEMON = "no daemon answers";
const COLUMNS = ["NAME", "ID", "CREATED", "LAST SEEN", "LAST IP", "STATE"];
const EMPTY = "-";

function openRegistry(context: CommandContext): DeviceRegistry {
  const { stateDir } = loadConfig(context.configPath);
  return createDeviceRegistry({ path: join(stateDir, REGISTRY_FILE), now: context.now });
}

export async function runSetPassword(context: CommandContext): Promise<number> {
  const password = await context.io.readPassword();
  if (password.length < MIN_PASSWORD_LENGTH) throw new FardeskError("invalid_request", `the password needs at least ${MIN_PASSWORD_LENGTH} characters`);
  writePasswordHash(context.configPath, await hashPassword(password));
  const reloaded = await callDaemon(context, { method: "POST", path: "/v1/auth/reload" }, okResultSchema);
  if (reloaded !== null) {
    context.io.stdout("password set; the running daemon reloaded it and revoked every device token");
    return EXIT_OK;
  }
  const revoked = openRegistry(context).revokeAll().length;
  context.io.stdout(`password set; ${NO_DAEMON}, revoked ${revoked} device token(s) in the registry file`);
  return EXIT_OK;
}

const cell = (value: string | null): string => value ?? EMPTY;

export function formatDeviceTable(devices: AuthDevice[]): string[] {
  const rows = devices.map((device) => [
    device.name,
    device.id,
    device.createdAt,
    cell(device.lastSeenAt),
    cell(device.lastIp),
    device.revoked ? "revoked" : "active",
  ]);
  const widths = COLUMNS.map((title, index) => Math.max(title.length, ...rows.map((row) => (row[index] as string).length)));
  const line = (values: string[]): string => values.map((value, index) => value.padEnd(widths[index] as number)).join("  ").trimEnd();
  return [line(COLUMNS), ...rows.map(line)];
}

export async function runDevices(context: CommandContext): Promise<number> {
  const answer = await callDaemon(context, { method: "GET", path: "/v1/auth/devices" }, authDeviceListSchema);
  const devices = answer === null ? openRegistry(context).list(null) : answer.devices;
  if (answer === null) context.io.stdout(`${NO_DAEMON}: reading the registry file`);
  for (const line of formatDeviceTable(devices)) context.io.stdout(line);
  return EXIT_OK;
}

export async function runRevoke(context: CommandContext): Promise<number> {
  if (context.all === (context.target !== null)) {
    context.io.stderr("revoke needs exactly one of <device> or --all");
    return EXIT_USAGE;
  }
  const device = context.target;
  const answer = await callDaemon(context, { method: "POST", path: "/v1/auth/revoke", body: { device } }, revokeResultSchema);
  if (answer !== null) {
    context.io.stdout(`revoked ${answer.revoked} device(s); open streams closed and wipe pushes sent`);
    return EXIT_OK;
  }
  const revoked = openRegistry(context).revoke(device).length;
  context.io.stdout(`${NO_DAEMON}: revoked ${revoked} device(s) in the registry file (no wipe push sent)`);
  return EXIT_OK;
}

/** Replaces the master token; device tokens (phones) stay valid, hubs that hold the old token must be given the new one. */
export async function runRotateToken(context: CommandContext): Promise<number> {
  const config = loadConfig(context.configPath);
  const answer = await callDaemon(context, { method: "POST", path: "/v1/auth/rotate-token" }, okResultSchema);
  if (answer === null) {
    updateConfigFile(context.configPath, { token: newMasterToken() });
    context.io.stdout(`${NO_DAEMON}: wrote a new master token to ${context.configPath}; the next fardeskd start uses it`);
  } else {
    context.io.stdout(`master token replaced in ${context.configPath}; the running daemon uses it already`);
  }
  context.io.stdout("the old master token is dead; logged-in devices (phones) keep working");
  context.io.stdout(`hub links to renew: every hub that lists "${config.name}" in coordinator.peerTokens holds the old token; copy the new one from ${context.configPath} (key token) to that hub`);
  return EXIT_OK;
}
