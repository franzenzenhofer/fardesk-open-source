// serve, init and status.
import { literalBindAddress } from "../config/bind.js";
import { createTailscaleProbe, describeState } from "../config/tailscale.js";
import { loadConfig, writeInitialConfig } from "../config/config.js";
import type { Config } from "../config/config.js";
import { daemonUrl } from "../pairing/index.js";
import { startHub } from "../hub/hub.js";
import { createStreamRouter } from "../hub/relay.js";
import { createApp } from "../server/app.js";
import { startServer } from "../server/listen.js";
import { createServices } from "../service/services.js";
import { readCrossSessionInbound } from "../sessions/crossSession.js";
import { serveOnAddresses } from "./serveLoop.js";
import { printUnconfiguredHomes } from "./homesCommands.js";
import { hookStateOf, settingsPathsOf } from "./hooks.js";
import { EXIT_OK, EXIT_USAGE } from "./types.js";
import type { CommandContext } from "./types.js";

const STATUS_TIMEOUT_MS = 2000;

export async function runServe(context: CommandContext): Promise<number> {
  const { io, deps } = context;
  const config = loadConfig(context.configPath);
  const literal = literalBindAddress(config);
  const services = await createServices(config, { createOwned: deps.createOwned, run: context.run, configPath: context.configPath });
  const hub = startHub(config, services);
  try {
    const streamRouter = hub === null ? {} : { streamRouter: createStreamRouter(hub) };
    const wiring = hub === null ? null : { hub, config };
    await serveOnAddresses(context, literal, async (address) => {
      const listen = { address, port: config.bind.port, tls: config.tls, pingMs: config.intervals.pingMs, ...streamRouter };
      const running = await startServer(createApp(services, undefined, wiring), listen, services.bus, services);
      io.stdout(`fardeskd listening on ${daemonUrl(config, running.address)}`);
      return running;
    });
  } finally {
    hub?.close();
    await services.close();
  }
  return EXIT_OK;
}

export function runInit(context: CommandContext): number {
  if (context.name === null) {
    context.io.stderr("init needs --name <machine name>");
    return EXIT_USAGE;
  }
  writeInitialConfig(context.configPath, context.name);
  context.io.stdout(`wrote ${context.configPath} (machine name ${context.name}); run \`fardeskd install-hooks\` and \`fardeskd pair\` next`);
  return EXIT_OK;
}


async function daemonAnswer(url: string, token: string): Promise<string> {
  try {
    const response = await fetch(`${url}/v1/machine`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    return response.ok ? "answers GET /v1/machine" : `answered HTTP ${response.status}`;
  } catch (error) {
    return `does not answer (${(error as Error).message})`;
  }
}

/** The address to ask, or null when Tailscale has none (its state is printed as one plain line). */
async function statusAddress(context: CommandContext, config: Config): Promise<string | null> {
  const literal = literalBindAddress(config);
  if (literal !== null) return literal;
  const state = await createTailscaleProbe(context.tailscaleCommands, context.run, () => undefined)();
  context.io.stdout(describeState(state));
  return state.kind === "running" ? state.address : null;
}

export async function runStatus(context: CommandContext): Promise<number> {
  const { io } = context;
  const config = loadConfig(context.configPath);
  io.stdout(`config: ${context.configPath}`);
  try {
    const address = await statusAddress(context, config);
    if (address !== null) {
      const url = daemonUrl(config, address);
      io.stdout(`bind address: ${url}`);
      io.stdout(`daemon: ${await daemonAnswer(url, config.token)}`);
    }
  } catch (error) {
    io.stdout(`bind address: not resolved (${(error as Error).message})`);
  }
  for (const path of settingsPathsOf(config)) io.stdout(`hooks ${path}: ${hookStateOf(path, config)}`);
  for (const home of config.claudeHomes) io.stdout(`crossSessionInbound ${home}: ${readCrossSessionInbound(home) ?? "not set"}`);
  await printUnconfiguredHomes(context, config);
  return EXIT_OK;
}
