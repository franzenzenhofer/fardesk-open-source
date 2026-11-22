// A broker on its own bus with a fixed clock, for the broker tests.
import { createBus } from "../../src/core/bus.js";
import type { StreamEvent } from "../../src/contract/schema.js";
import { createBroker } from "../../src/permissions/broker.js";
import type { AskInput, Broker } from "../../src/permissions/broker.js";

export const BROKER_NOW = new Date("2026-11-15T10:00:00.000Z");

export function setupBroker(timeoutMs: number, allowBypass = true): { broker: Broker; events: StreamEvent[] } {
  const bus = createBus();
  const events: StreamEvent[] = [];
  bus.subscribe((event) => events.push(event));
  let counter = 0;
  const broker = createBroker({ timeoutMs, bus, now: () => BROKER_NOW, newId: () => `id${String(++counter)}`, allowBypass });
  return { broker, events };
}

export const bash = (command: string): AskInput => ({ sessionId: "s1", toolName: "Bash", toolInput: { command }, cwd: "/work" });
export const ask = (input: unknown, sessionId = "s1", toolName = "AskUserQuestion"): AskInput => ({ sessionId, toolName, toolInput: input, cwd: "/work" });
