#!/usr/bin/env node
// A stand-in claude executable that speaks the Agent SDK stream-json protocol just far enough to send dialogs.
// FAKE_SESSION_ID: the session id it reports. FAKE_DIALOGS: JSON array of { id, kind, payload, cancelAfterMs? } sent as request_user_dialog control requests
// after the first user message. Every line the SDK writes to stdin is appended to FAKE_DIALOG_LOG (one JSON per line).
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("2.1.330 (fake)\n");
  process.exit(0);
}

const SESSION_ID = process.env.FAKE_SESSION_ID;
const log = process.env.FAKE_DIALOG_LOG;
const dialogs = JSON.parse(process.env.FAKE_DIALOGS ?? "[]");
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let started = false;

// FAKE_TOOLS: JSON array of { id, tool, input } sent as can_use_tool control requests, like Claude Code asking before a tool runs.
const tools = JSON.parse(process.env.FAKE_TOOLS ?? "[]");

function sendTools() {
  for (const call of tools) {
    send({ type: "control_request", request_id: call.id, request: { subtype: "can_use_tool", tool_name: call.tool, input: call.input, tool_use_id: `toolu_${call.id}` } });
  }
}

function sendDialogs() {
  send({ type: "system", subtype: "init", session_id: SESSION_ID, uuid: "00000000-0000-4000-8000-0000000000a1", cwd: process.cwd(), tools: [], model: "fake", permissionMode: "default" });
  sendTools();
  for (const dialog of dialogs) {
    send({ type: "control_request", request_id: dialog.id, request: { subtype: "request_user_dialog", dialog_kind: dialog.kind, payload: dialog.payload } });
    if (dialog.cancelAfterMs !== undefined) setTimeout(() => send({ type: "control_cancel_request", request_id: dialog.id }), dialog.cancelAfterMs);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  appendFileSync(log, `${line}\n`);
  const message = JSON.parse(line);
  if (message.type === "control_request") {
    send({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
  } else if (message.type === "user" && !started) {
    started = true;
    sendDialogs();
  }
});
