// Which Claude home a new owned session starts in.
import { homeByName, type ClaudeHomeEntry } from "../config/claudeHomes.js";
import { FardeskError } from "../core/errors.js";

/** The home called `name`; without a name the machine's first home. An unknown name is refused, never replaced by another home. */
export function startHome(homes: readonly ClaudeHomeEntry[], name: string | undefined): ClaudeHomeEntry {
  if (name !== undefined) return homeByName(homes, name);
  const [first] = homes;
  if (first === undefined) throw new FardeskError("invalid_request", "config.claudeHomes is empty: owned sessions need a Claude home");
  return first;
}
