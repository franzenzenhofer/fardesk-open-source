import { describe, expect, it } from "vitest";
import { parseObject, say, toolResult, toolUse, user } from "../../test/support/transcriptLines.js";
import { countOpenBackgroundTasks } from "./background.js";
import type { TranscriptLine } from "./lineTypes.js";
import { summarise } from "./summary.js";

const bashLaunch = (second: number, toolId: string, taskId: string): TranscriptLine[] => [
  toolUse(second, toolId, "Bash", { command: "npm test", run_in_background: true }),
  toolResult(second + 1, toolId, `Command running in background with ID: ${taskId}. Output is being written to: /tmp/${taskId}.output`),
];

const agentLaunch = (second: number, toolId: string, agentId: string): TranscriptLine[] => [
  toolUse(second, toolId, "Agent", { description: "research", prompt: "go", run_in_background: true }),
  toolResult(second + 1, toolId, [
    { type: "text", text: `Async agent launched successfully. (This tool result is internal metadata)\nagentId: ${agentId} (internal ID - do not mention to user.)` },
  ]),
];

const monitorLaunch = (second: number, toolId: string, taskId: string): TranscriptLine[] => [
  toolUse(second, toolId, "Monitor", { command: "tail -f log" }),
  toolResult(second + 1, toolId, `Monitor started (task ${taskId}, expires in 30m unless the source ends first; you get one notice at expiry)`),
];

const notification = (second: number, taskId: string, status: string): TranscriptLine =>
  user(second, `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n</task-notification>`, { origin: { kind: "task-notification" } });

describe("countOpenBackgroundTasks", () => {
  it("is 0 for a session without background work", () => {
    expect(countOpenBackgroundTasks([user(1, "hi"), say(2, "hello")])).toBe(0);
  });

  it("counts a Bash, an agent and a Monitor launched and not finished", () => {
    const lines = [...bashLaunch(1, "t1", "bk1x2y3z"), ...agentLaunch(3, "t2", "ad0bf08471755c8b7"), ...monitorLaunch(5, "t3", "boqx6gf4p"), say(7, "Running in the background.")];
    expect(countOpenBackgroundTasks(lines)).toBe(3);
  });

  it("drops a task once its task-notification arrives, whatever the final status", () => {
    const lines = [...bashLaunch(1, "t1", "bk1x2y3z"), ...agentLaunch(3, "t2", "ad0bf08471755c8b7"), ...monitorLaunch(5, "t3", "boqx6gf4p")];
    expect(countOpenBackgroundTasks([...lines, notification(8, "bk1x2y3z", "completed")])).toBe(2);
    expect(countOpenBackgroundTasks([...lines, notification(8, "bk1x2y3z", "completed"), notification(9, "ad0bf08471755c8b7", "failed"), notification(10, "boqx6gf4p", "killed")])).toBe(0);
  });

  it("ignores a notification for an unknown task and a launch text that is no tool result", () => {
    const lines = [notification(1, "unknown1", "completed"), user(2, "Command running in background with ID: fake123.")];
    expect(countOpenBackgroundTasks(lines)).toBe(0);
  });

  it("ignores lines of sub-agents in summarise (only the main thread counts)", () => {
    const side = parseObject({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "s1", content: "Command running in background with ID: side1." }] },
      uuid: "side-1",
      timestamp: "2026-01-01T10:00:09.000Z",
      isSidechain: true,
      cwd: "/work/project",
    });
    expect(summarise([...bashLaunch(1, "t1", "bk1x2y3z"), side], 80).backgroundTasks).toBe(1);
  });
});
