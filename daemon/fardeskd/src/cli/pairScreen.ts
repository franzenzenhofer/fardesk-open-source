// `fardeskd pair --show`: the pairing QR code goes to this computer's screen as a PNG in a private temporary folder, never to
// stdout or stderr, so an agent that runs the command does not see the code. The folder is removed when the window ends.
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { FardeskError } from "../core/errors.js";
import type { CommandContext } from "./types.js";

const QR_WIDTH_PX = 600;
const QR_MARGIN_MODULES = 4;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const NO_SCREEN = "no screen here to show the code: run `fardeskd pair` in a terminal you are looking at";

export type ScreenCode = { path: string; close(): Promise<void> };

function viewerFor(context: CommandContext): string {
  const platform = context.deps.platform ?? process.platform;
  const { env } = context.io;
  if (platform === "darwin") return "open";
  const display = (env["DISPLAY"] ?? "") !== "" || (env["WAYLAND_DISPLAY"] ?? "") !== "";
  if (platform === "linux" && display) return "xdg-open";
  throw new FardeskError("invalid_request", NO_SCREEN);
}

/** Throws before any window is opened when this computer has no screen to show an image on. */
export function requireScreen(context: CommandContext): void {
  viewerFor(context);
}

/** Renders `link` as a PNG in a fresh private folder and opens it with the system viewer. `close` removes the folder. */
export async function showOnScreen(context: CommandContext, link: string): Promise<ScreenCode> {
  const viewer = viewerFor(context);
  const dir = await mkdtemp(join(tmpdir(), "fardesk-pair-"));
  const close = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    await chmod(dir, PRIVATE_DIR_MODE);
    const path = join(dir, "pairing-code.png");
    await QRCode.toFile(path, link, { type: "png", width: QR_WIDTH_PX, margin: QR_MARGIN_MODULES, color: { dark: "#000000", light: "#ffffff" } });
    await chmod(path, PRIVATE_FILE_MODE);
    await context.run(viewer, [path]);
    return { path, close };
  } catch (error) {
    await close();
    throw new FardeskError("invalid_request", `${NO_SCREEN} (${(error as Error).message})`);
  }
}
