# Transcript fixtures

Real Claude Code transcript lines (Claude Code versions per file in the table below, see the version column), anonymised with
`scripts/anonymise-transcript.mjs`. Every key, value type, array shape, line order and uuid relationship is the
real one; all free text is replaced by deterministic filler of about the same length and line count. Nothing here was
invented. Each file is one real session, one contiguous window of a real session, or (names ending in `-bundle`) a
bundle of individually real lines from several sessions that is NOT one session.

Text longer than the per-fixture cap (default 1,500 characters; 05 3,000; 06 25,000 so its 20,734-character Bash output is whole; 07 1,000; 17 2,500) is truncated after the cap,
so a long string keeps its real line structure only up to the cap. Raw `api-request`, `api-request-blob` and
`api-request-shape` capture lines were reduced to the smallest real example of each type per fixture part (the parser
ignores them); the dropped counts are not stored in the repo. Image base64 is replaced by a valid 1x1 PNG. Commands in
Bash `input.command` survive only when they match the allow-list (`npm test`, `npm run <word>`, `swift test`,
`swift build`, `git status`, `git diff`, `ls`, `sleep N`, `npx vitest ...`, optionally `cd <dir> && ` before
and `2>&1` / `| tail -N` after); all others are `echo step-N`. Timestamps are shifted by one fixed offset.

## Real on-disk layout (this machine, Claude Code 2.1.32x)

- Main session: `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` (encoded-cwd = absolute path with every non-alphanumeric character replaced by `-`).
- Subagent transcripts: `~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl` plus `agent-<agentId>.meta.json` (see 08 fixtures). Every line of a subagent file has `isSidechain: true`; main-session files never contain sidechain lines. Workflow subagents live in `.../subagents/workflows/wf_<id>/agent-<agentId>.jsonl` with a `journal.jsonl` (23).
- Large tool outputs: `<sessionId>/tool-results/<id>.txt` (persistedOutputPath); `<sessionId>/session-memory/`; `<sessionId>/workflows/` (scripts + wf_*.json).
- A resumed session was not found in real data: no file contains a sessionId different from its file name.

## Fixtures

| file | lines | size | Claude Code version | what it contains / bullets covered |
|---|---|---|---|---|
| 01-simple-session.jsonl | 79 | 286 KB | 2.1.312 | real interactive cli session: user prompt, assistant thinking/text, 7 tool calls (Bash ok x4, Bash error with is_error, 2 consecutive Edit/Write), final end_turn answer; ai-title, last-prompt, queue-operation, mode, permission-mode, session-owner, file-history-snapshot, hook attachments, stop_hook_summary, cost-state |
| 01b-minimal-session.jsonl | 48 | 250 KB | 2.1.318 | smallest session: one prompt, one Bash call and result, answer; hook attachments, stop_hook_summary |
| 02-interrupt-denied-bash-error.jsonl | 51 | 241 KB | 2.1.325 | interrupted request ([Request interrupted by user] and ... for tool use); user permission denial (tool_result is_error, toolDenialKind user-rejected); Bash error; tools-used; cost-state |
| 03-grep-read-run.jsonl | 42 | 131 KB | 2.1.303 | sdk-py headless review session: Grep x2 and 5 consecutive Read/Grep calls, StructuredOutput tool, structured_output attachment, cost-state |
| 04-glob.jsonl | 41 | 126 KB | 2.1.303 | sdk-py headless review session: Glob, Read, StructuredOutput |
| 05-edit-write-read-test-run.jsonl | 88 | 126 KB | 2.1.319 | Edit (structuredPatch), consecutive Edits, Write (create), Read, Bash ok, Bash with test run (allow-listed commands survive, others become echo step-N), ToolSearch, Monitor, edited_text_file attachment |
| 06-long-bash-output.jsonl | 27 | 177 KB | 2.1.303 | sidechain with a 20,734-character Bash output (kept whole), plus a Bash error and Bash ok |
| 07-agent-parent-window.jsonl | 53 | 122 KB | 2.1.319 | Agent tool_use with async_launched tool_result (toolUseResult.agentId / outputFile), queued_command attachments, TaskStop, ToolSearch, large Read result (image base64 replaced by 1x1 PNG) |
| 08-subagent-sidechain-denied.jsonl | 17 | 70 KB | 2.1.319 | subagent transcript (isSidechain true on every line), permission denial inside a subagent, interrupted request; layout of subagents/agent-<id>.jsonl |
| 08-subagent-sidechain-denied.meta.json | 1 | 0 KB | n/a | the agent-<id>.meta.json that sits next to every subagent transcript (agentType, description, toolUseId links to the parent Agent tool_use id) |
| 09-subagent-edit-write-read-test.jsonl | 55 | 275 KB | 2.1.322 | sidechain with Edit, Write, Read and test-running Bash |
| 10-askuserquestion.jsonl | 13 | 20 KB | 2.1.323 | AskUserQuestion tool_use + tool_result (toolUseResult has questions, answers, annotations); stop-hook feedback user line (isMeta) |
| 11-task-tools.jsonl | 18 | 25 KB | 2.1.319 | TaskCreate and TaskUpdate (tool_use + results with taskId/statusChange) |
| 12-web-mcp-devtools.jsonl | 59 | 253 KB | 2.1.319 | MCP tool calls (mcp__plugin_chrome-devtools-mcp_chrome-devtools__*), WebFetch, WebSearch, ToolSearch, deferred_tools_record, Write |
| 13-webfetch-websearch.jsonl | 81 | 271 KB | 2.1.317 | many WebFetch (toolUseResult bytes/code/url) and WebSearch (toolUseResult query/results) calls in a sidechain |
| 14-meta-slash-local-command.jsonl | 10 | 9 KB | 2.1.319 | isMeta user line with <local-command-caveat>, slash command user line (<command-name>/clear, <command-message>, <command-args>), system/local_command, SessionStart hook attachments |
| 15-local-command-stdout.jsonl | 13 | 9 KB | 2.1.322 | <local-command-stdout> user message after a local command, permission-mode line |
| 16-image-block.jsonl | 89 | 267 KB | 2.1.308 | user message with image content blocks (base64 data replaced by a 1x1 PNG), Read of an image, stop_hook_summary, turn_duration, away_summary |
| 17-compaction-window.jsonl | 23 | 89 KB | 2.1.322 | compaction: system/compact_boundary, user line with isCompactSummary, attachment file/task_status, system-reminder inside a user string, away_summary; window cut around the real boundary |
| 18-sdk-py-session.jsonl | 36 | 133 KB | 2.1.310 | headless/SDK session: entrypoint sdk-py, StructuredOutput tool, structured_output attachment, queue-operation |
| 19-sdk-py-api-error-grep.jsonl | 43 | 133 KB | 2.1.310 | sdk-py session with system/api_error and Grep |
| 20-sdk-cli-session.jsonl | 53 | 154 KB | 2.1.314 | entrypoint sdk-cli, agent-setting line |
| 21-claude-desktop-session.jsonl | 42 | 235 KB | 2.1.286 | entrypoint claude-desktop, custom-title and agent-name lines, stop_hook_summary, hook_blocking_error, system-reminder inside a user content block |
| 22-system-subtypes-turn-away-hook.jsonl | 50 | 237 KB | 2.1.306 | system/turn_duration, system/stop_hook_summary, system/away_summary, ai-title, last-prompt |
| 23-workflow-journal.jsonl | 7 | 14 KB | n/a | workflow journal.jsonl: line types launched, started, result (no sessionId, not a Claude transcript line shape) |
| 24-queued-skill-sendmessage-subagent.jsonl | 69 | 247 KB | 2.1.310 | sidechain with SendMessage, WebSearch, a Bash error, isMeta user lines |
| 25-scheduled-queue-attachments.jsonl | 106 | 297 KB | 2.1.317 | artifact-comment-monitor, artifact-autoreact-ledger, tools-used, file-history-delta, task_reminder, silent_turn_reminder, queued_command, turn_duration, away_summary |
| 26-rare-lines-bundle.jsonl | 13 | 19 KB | 2.1.318, 2.1.322, 2.1.312, 2.1.317, 2.1.319 | BUNDLE of individually real lines (not one session): system/informational, system/scheduled_task_fire, system/bridge_status, bridge-session, pr-link, frame-link, diagnostics, goal_status, invoked_skills, ExitPlanMode |
| 27-unfinished-tool-use-cut.jsonl | 8 | 10 KB | 2.1.319 | transcript cut right after a real assistant tool_use (Bash) line: tool_use with no tool_result yet |
| 28-rare-tools-bundle.jsonl | 28 | 52 KB | 2.1.302, 2.1.322, 2.1.319, 2.1.309, 2.1.318, 2.1.314, 2.1.303, 2.1.317 | BUNDLE of real tool_use/tool_result line pairs: ListAgents, Workflow, TaskList, PushNotification, CronCreate/List/Delete, ScheduleWakeup, EnterPlanMode, SendFeedback, Artifact, Skill, bash (lowercase, invalid tool), bash_placeholder |
| 29-rare-attachments-bundle.jsonl | 16 | 22 KB | 2.1.319, 2.1.322, 2.1.306, 2.1.310, 2.1.316, 2.1.318, 2.1.325, 2.1.311, 2.1.312, 2.1.321 | BUNDLE of single real lines: command_permissions, edited_text_file, batching_reminder_sent, bash_output_audience_note, read_truncation_notice, plan_mode_exit, nested_memory, system/agents_killed, auto_mode_exit, hook_cancelled, max_turns_reached, plan_mode_reentry, thinking_drop, compact_file_reference, plan_file_reference, dynamic_skill |
| 30-peer-message-reply.jsonl | 68 | 366 KB | 2.1.325 | session on the Linux box that received 4 peer messages (a reply sent by Fardesk into a terminal session): user lines with origin.kind "peer", isMeta true, turnOrigin "peer", promptSource "system", content a plain string. Fully anonymised, so the wrapper wording is filler (see 31 for the real boilerplate); also local-command /exit lines |
| 32-queued-prompt-absorbed-mid-turn.jsonl | 7 | 3 KB | 2.1.325 | real shapes (ids neutralised): a prompt sent into a working session is recorded as queue-operation enqueue + remove(absorbed_mid_turn) + an `attachment` line with attachment.type queued_command, commandMode prompt, origin.kind human - and no type:user line. Plus a cancelled enqueue/remove that must show nothing |
| 31-peer-message-wrapper.jsonl | 6 | 7 KB | 2.1.325 | real line, boilerplate kept: 2 real peer user lines (+ assistant reply + turn_duration each) with only ids, cwd, pid and the peer sender neutralised. Prefix "Another Claude session sent a message:" + newline, then the peer text, then the boilerplate suffix starting "This came from another Claude session" (kept verbatim) |

## Not found in real data (searched all 2,075 jsonl files on this machine)

TodoWrite, MultiEdit, NotebookEdit, a `summary` line type (compaction is `system/compact_boundary` + a user line with
`isCompactSummary`), a `Task` tool name (the subagent tool is called `Agent`), a resumed session continued under the
same session id in one file, and an `ide_opened_file`-style user text block. Also not captured: any user line with a
real `<system-reminder>` inside a tool_result string beyond 21 and the boilerplate one-liners.

## Histograms: 60 most recently modified main sessions plus their subagent files (625 files)

Line `type` / `subtype` (top 40):

| line type | count |
|---|---|
| assistant | 52,162 |
| user | 33,553 |
| api-request | 25,670 |
| api-request-blob | 19,615 |
| attachment | 16,619 |
| queue-operation | 6,352 |
| last-prompt | 5,616 |
| session-owner | 5,597 |
| mode | 5,594 |
| atis-latch | 5,589 |
| ai-title | 5,535 |
| permission-mode | 3,440 |
| system/stop_hook_summary | 3,000 |
| system/turn_duration | 1,487 |
| file-history-delta | 1,331 |
| agent-name | 763 |
| api-request-shape | 583 |
| tools-used | 553 |
| file-history-snapshot | 453 |
| system/away_summary | 344 |
| cost-state | 72 |
| system/informational | 27 |
| system/compact_boundary | 23 |
| system/local_command | 18 |

Content block types (message.content):

| role:block | count |
|---|---|
| assistant:tool_use | 29,458 |
| user:tool_result | 29,453 |
| assistant:thinking | 15,595 |
| api-request-blob:tool_use | 14,969 |
| api-request-blob:tool_result | 14,361 |
| api-request-blob:text | 8,763 |
| assistant:text | 7,110 |
| api-request-blob:thinking | 5,455 |
| user:<string> | 3,830 |
| api-request-blob:tool_addition | 1,065 |
| user:text | 321 |
| api-request-blob:image | 206 |
| api-request-blob:<string> | 181 |
| user:image | 157 |

tool_use names (all):

| tool | count |
|---|---|
| Bash | 22,803 |
| Edit | 6,304 |
| Write | 5,372 |
| Read | 4,672 |
| Monitor | 1,154 |
| Agent | 502 |
| TaskUpdate | 431 |
| WebFetch | 409 |
| ToolSearch | 366 |
| mcp__claude-in-chrome__browser_batch | 332 |
| SendMessage | 318 |
| TaskStop | 314 |
| mcp__claude-in-chrome__computer | 307 |
| TaskCreate | 254 |
| mcp__claude_ai_Gmail__search_threads | 145 |
| WebSearch | 131 |
| Skill | 63 |
| mcp__claude-in-chrome__navigate | 56 |
| mcp__claude-in-chrome__find | 49 |
| mcp__claude_ai_Gmail__get_thread | 48 |
| mcp__claude-in-chrome__javascript_tool | 44 |
| mcp__claude-in-chrome__get_page_text | 36 |
| mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script | 36 |
| mcp__claude-in-chrome__tabs_context_mcp | 34 |
| mcp__claude-in-chrome__tabs_close_mcp | 28 |
| AskUserQuestion | 25 |
| mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot | 19 |
| ListAgents | 17 |
| mcp__claude-in-chrome__file_upload | 17 |
| mcp__claude_ai_Gmail__get_message | 15 |
| mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page | 15 |
| mcp__claude-in-chrome__read_page | 13 |
| mcp__claude_ai_Google_Calendar__list_events | 12 |
| mcp__claude-in-chrome__tabs_create_mcp | 11 |
| Workflow | 11 |
| mcp__claude_ai_Gmail__unlabel_thread | 8 |
| mcp__plugin_chrome-devtools-mcp_chrome-devtools__resize_page | 7 |
| ExitPlanMode | 6 |
| mcp__claude-in-chrome__form_input | 5 |
| mcp__claude-in-chrome__list_connected_browsers | 4 |
| TaskList | 4 |
| mcp__plugin_chrome-devtools-mcp_chrome-devtools__close_page | 4 |
| mcp__claude_ai_Google_Calendar__create_event | 4 |
| mcp__plugin_chrome-devtools-mcp_chrome-devtools__emulate | 4 |
| mcp__claude_ai_Gmail__download_gmail_attachment | 3 |
| bash | 3 |
| mcp__claude-in-chrome__read_console_messages | 3 |
| mcp__claude_ai_Google_Calendar__update_event | 2 |
| mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page | 2 |
| mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_snapshot | 2 |
| mcp__claude_ai_Gmail__list_drafts | 1 |
| mcp__claude_ai_Google_Calendar__search_events | 1 |
| mcp__claude_ai_Google_Calendar__list_calendars | 1 |

Attachment types:

| attachment.type | count |
|---|---|
| deferred_tools_record | 4,881 |
| queued_command | 1,940 |
| hook_blocking_error | 1,518 |
| task_reminder | 1,475 |
| environment | 715 |
| prompt_snapshot | 705 |
| edited_text_file | 675 |
| date | 373 |
| skill_listing | 368 |
| silent_turn_reminder | 366 |
| model | 361 |
| deferred_tools_delta | 360 |
| mcp_instructions_delta | 360 |
| session_context | 353 |
| credential_org | 353 |
| remote_session_change | 352 |
| agent_listing_delta | 351 |
| instructions | 348 |
| auto_mode | 314 |
| file | 111 |
| hook_success | 96 |
| hook_additional_context | 82 |
| hook_cancelled | 48 |
| command_permissions | 43 |
| invoked_skills | 19 |
| task_status | 18 |
| thinking_drop | 7 |
| read_truncation_notice | 6 |
| plan_mode | 5 |
| compact_file_reference | 4 |
| plan_mode_exit | 3 |
| auto_mode_exit | 3 |
| plan_file_reference | 3 |
| goal_status | 2 |
| dynamic_skill | 1 |

toolUseResult shapes (key sets, top 25):

| keys | count |
|---|---|
| interrupted,isImage,noOutputExpected,stderr,stdout | 12,806 |
| content,filePath,originalFile,structuredPatch,type,userModified | 3,094 |
| file,type | 2,668 |
| contentNotInModelContext,filePath,newString,oldString,originalFile,replaceAll,structuredPatch,userModified | 2,006 |
| bashEditDiff,interrupted,isImage,noOutputExpected,stderr,stdout | 1,375 |
| string | 1,208 |
| filePath,newString,oldString,originalFile,replaceAll,structuredPatch,userModified | 1,070 |
| array | 864 |
| persistent,taskId,timeoutMs | 822 |
| interrupted,isImage,noOutputExpected,staleReadFileStateHint,stderr,stdout | 431 |
| bytes,code,codeText,durationMs,result,url | 309 |
| agentId,canContinueAgent,canReadOutputFile,description,isAsync,outputFile,prompt,resolvedModel,status | 280 |
| matches,query,total_deferred_tools | 250 |
| interrupted,isImage,noOutputExpected,returnCodeInterpretation,stderr,stdout | 213 |
| statusChange,success,taskId,updatedFields | 199 |
| bashEditDiff,interrupted,isImage,noOutputExpected,staleReadFileStateHint,stderr,stdout | 183 |
| command,message,task_id,task_type | 173 |
| backgroundTaskId,interrupted,isImage,noOutputExpected,stderr,stdout | 167 |
| backgroundTaskId,interrupted,isImage,noOutputExpected,stderr,stdout,subagentCapApplied,timedOutAfterMs | 160 |
| task | 133 |
| durationSeconds,query,results,searchCount | 109 |
| interrupted,isImage,noOutputExpected,persistedOutputPath,persistedOutputSize,stderr,stdout | 85 |
| message,pin,success | 84 |
| dangerouslyDisableSandbox,interrupted,isImage,noOutputExpected,stderr,stdout | 76 |
| backgroundTaskId,interrupted,isImage,noOutputExpected,stderr,stdout,timedOutAfterMs | 73 |

entrypoint: {"cli":107223,"sdk-cli":10}; version: {"2.1.325":14811,"2.1.323":7492,"2.1.322":73384,"2.1.321":37799}.

## Whole-corpus line counts (all 2,075 jsonl files, 13 files over 60 MB skipped)

Line types: assistant 196104, user 123069, attachment 83410, last-prompt 20611, atis-latch 20504, ai-title 19203, mode 19128, queue-operation 18674, permission-mode 15536, session-owner 11065, system/stop_hook_summary 8071, system/turn_duration 3963, file-history-delta 3531, agent-name 3296, tools-used 2055, file-history-snapshot 1757, system/away_summary 870, cost-state 631, started 252, result 249, bridge-session 209, system/local_command 82, pr-link 68, frame-link 64, system/api_error 61, system/informational 53, system/scheduled_task_fire 42, agent-setting 25, system/compact_boundary 20, launched 10, artifact-autoreact-ledger 10, artifact-comment-monitor 4, custom-title 3, system/bridge_status 2, system/agents_killed 2.

Tools: Bash 66913, Read 9523, Write 8439, Edit 5367, WebFetch 3680, Monitor 2230, mcp__claude-in-chrome__computer 2085, WebSearch 2031, ToolSearch 1214, Agent 1093, mcp__claude-in-chrome__browser_batch 815, mcp__claude-in-chrome__navigate 611, TaskStop 558, TaskUpdate 538, mcp__claude-in-chrome__javascript_tool 538, StructuredOutput 476, SendMessage 473, mcp__claude_ai_Gmail__search_threads 441, mcp__claude-in-chrome__find 306, mcp__claude-in-chrome__get_page_text 303, TaskCreate 295, mcp__claude-in-chrome__tabs_context_mcp 293, Skill 226, Grep 224, mcp__claude_ai_Gmail__get_thread 166, mcp__claude-in-chrome__tabs_close_mcp 125, AskUserQuestion 125, mcp__claude-in-chrome__tabs_create_mcp 68, mcp__claude_ai_Google_Calendar__list_events 68, mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script 62, ExitPlanMode 50, mcp__claude-in-chrome__form_input 48, ListAgents 44, mcp__claude_ai_Google_Calendar__update_event 43, mcp__claude_ai_Google_Calendar__create_event 43, mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot 41, mcp__claude_ai_Gmail__get_message 40, mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page 38, mcp__claude-in-chrome__read_page 32, bash 31, Glob 28, mcp__claude_ai_Google_Calendar__search_events 24, mcp__claude-in-chrome__file_upload 22, mcp__claude_ai_Gmail__unlabel_thread 20, mcp__claude_ai_Gmail__list_drafts 19, mcp__claude_ai_Claude_Docs__update 19, mcp__claude-in-chrome__list_connected_browsers 16, mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page 12, mcp__playwright__browser_evaluate 11, mcp__plugin_chrome-devtools-mcp_chrome-devtools__emulate 8, mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_snapshot 7, mcp__claude_ai_Google_Drive__search_files 6, mcp__claude-in-chrome__read_network_requests 6, mcp__claude_ai_Claude_Docs__read 6, TaskList 6, mcp__claude-in-chrome__read_console_messages 6, Workflow 5, CronCreate 5, mcp__claude_ai_Google_Drive__read_file_content 5, mcp__plugin_chrome-devtools-mcp_chrome-devtools__close_page 4, mcp__claude_ai_Google_Calendar__list_calendars 4, mcp__playwright__browser_navigate 3, mcp__playwright__browser_network_requests 3, mcp__claude_ai_Gmail__list_labels 3, PushNotification 3, mcp__claude_ai_Google_Drive__update_file 3, mcp__claude_ai_Gmail__download_gmail_attachment 3, bash_placeholder 3, mcp__claude_ai_Claude_Docs__guide 3, Artifact 3, ScheduleWakeup 3, mcp__claude_ai_Gmail__create_label 2, mcp__claude_ai_Google_Drive__get_file_permissions 2, mcp__claude_ai_Claude_Docs__batch 2, mcp__claude-in-chrome__switch_browser 2, EnterPlanMode 2, mcp__plugin_chrome-devtools-mcp_chrome-devtools__resize_page 2, CronDelete 2, mcp__claude-in-chrome__screenshot 1, mcp__claude_ai_Google_Drive__get_file_metadata 1, mcp__claude_ai_Claude_Docs__create 1, mcp__claude_ai_Gmail__get_draft 1, mcp__claude_ai_Gmail__mark_thread_spam 1, mcp__claude_ai_Google_Calendar__get_event 1, mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_pages 1, SendFeedback 1, mcp__plugin_chrome-devtools-mcp_chrome-devtools__fill 1, mcp__plugin_chrome-devtools-mcp_chrome-devtools__click 1, CronList 1, mcp__claude-artifacts__get_artifact 1, mcp__claude-artifacts__list_artifacts 1.

## Notes for readers of the fixtures

- The tool names of the author's own connectors remain in the files (about 30 distinct `mcp__*` names). They are names, not data.
- The file layout is Claude Code's own, undocumented internal format. It can change with any Claude Code release; the fixtures document what one version wrote, not a contract.
- To re-run `scripts/anonymise-transcript.mjs` you need a private terms file (`~/.config/fardesk/anonymise-terms.json`, or the path in `FARDESK_ANONYMISE_TERMS`) with the arrays `forbiddenSubstrings`, `neutralProjects`, `folderPrefixes` and `commonWords`. It names real people, hosts and folders and is never committed; the script stops when it is missing.
