#!/usr/bin/env node
// Anonymises a Claude Code transcript (.jsonl) while keeping its exact structure.
// Usage: node anonymise-transcript.mjs <in.jsonl> <out.jsonl> [--max-chars N] [--lines A-B]
//        node anonymise-transcript.mjs --verify <file.jsonl>...
// Deterministic, no dependencies. Default for every string is "replace with filler";
// only the explicit allow-lists below keep real values.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTerms } from './anonymise-terms.mjs';

const HOME = os.homedir();
const USER = os.userInfo().username;
const TIME_OFFSET_MS = -(400 * 86400000 + 3 * 3600000 + 17 * 60000 + 5500);
const TERMS = loadTerms();
const NEUTRAL_PROJECTS = TERMS.neutralProjects;
const WORDS = ['alpha', 'bravo', 'cedar', 'delta', 'ember', 'gamma', 'harbor', 'iris', 'juniper', 'kernel', 'lumen', 'maple', 'nectar', 'orbit', 'pixel', 'quartz', 'river', 'saffron', 'tundra', 'umber', 'velvet', 'willow', 'xenon', 'yarrow', 'zephyr', 'amber', 'basil', 'coral', 'dune', 'fern', 'glade', 'hazel', 'indigo', 'jade', 'lotus', 'meadow', 'nimbus', 'opal', 'pine', 'reed', 'slate', 'thistle', 'vale', 'wren', 'aspen', 'birch', 'clover', 'drift', 'elm'];
const PLACEHOLDER_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const API_TYPES = new Set(['api-request', 'api-request-blob', 'api-request-shape']);

const KEEP_KEYS = new Set(['type', 'subtype', 'role', 'model', 'requestedModel', 'advisorModel', 'modelId', 'marketingName', 'resolvedModel', 'stop_reason', 'entrypoint', 'permissionMode', 'fromMode', 'mode', 'effort', 'perTurnEffort', 'service_tier', 'speed', 'inference_geo', 'version', 'userType', 'platform', 'shell', 'osVersion', 'knowledgeCutoff', 'status', 'media_type', 'operation', 'decision', 'source', 'reasonType', 'reasonCode', 'toolDenialKind', 'kind', 'commandMode', 'hookEvent', 'hookName', 'level', 'thinkingDisplay', 'copy', 'renderedRole', 'madeBy', 'contextRendering', 'promptCacheRequested', 'promptSource', 'reason', 'task_type', 'tool_name', 'producer', 'phase', 'action', 'eventType', 'availability', 'responseStatus', 'field', 'returnCodeInterpretation', 'codeText', 'attributionAgent', 'attributionMcpServer', 'attributionMcpTool', 'toolsUsed[]', 'matches[]', 'server', 'messageFormat', 'view', 'timeZone', 'transparency', 'output_mode', 'turnOrigin', 'bashFirstSteer', 'mcpCallNotReadOnly', 'updatedFields[]', 'preCompactDiscoveredTools[]', 'surfacedNames[]', 'addedTypes[]', 'builtInTypes[]', 'stop_sequence', 'gitOperation', 'taskType', 'workflowName', 'hookEventName']);
const AGENT_KEYS = new Set(['subagent_type', 'agentType', 'agent_type', 'attributionAgent', 'addedTypes[]', 'builtInTypes[]', 'removedTypes[]']);
const BUILTIN_AGENTS = new Set(['claude', 'claude-code-guide', 'Explore', 'general-purpose', 'Plan', 'statusline-setup', 'workflow-subagent', 'fork']);
const SPACE_OK = new Set(['returnCodeInterpretation', 'codeText', 'marketingName', 'knowledgeCutoff', 'osVersion']);
const ID_KEY =/(Uuid|UUID|Id|ID|_id|Ids|Hash|Hashes|Request|requestRef|Ref|ref|digests\[\]|allUuids\[\]|uuids\[\]|^uuid|^id|^task_id|^backgroundTaskId|^runId|^leafUuid|^delivery_id|^source_uuid)$/;
const PATH_KEYS = new Set(['file_path', 'filePath', 'path', 'cwd', 'directory', 'notebook_path', 'dir', 'outputFile', 'output_file', 'persistedOutputPath', 'scriptPath', 'transcriptDir', 'realParentDir', 'displayPath', 'live_cwd', 'workingDirectory', 'scratchpadDirectory', 'trackingPath', 'filename', 'plan_file', 'planFilePath', 'changedFiles[]', 'outputDir', 'worktreePath']);
const KNOWN_SEGMENTS = new Set(['', 'Users', 'dev', 'tmp', 'private', 'var', 'folders', 'usr', 'bin', 'etc', 'opt', 'Library', 'Applications', 'Volumes', 'home', '.claude', 'projects', 'plans', 'scratchpad', 'tool-results', 'subagents', 'workflows', 'session-memory', 'node_modules', 'src', 'test', 'tests', 'scripts', 'lib', 'dist', 'build', '.git', 'docs', 'Sources', 'Package.swift', 'package.json', 'tsconfig.json', 'README.md', 'CLAUDE.md', '.gitignore', 'Documents', 'Desktop', 'Downloads', '.local', '.config', '.cache', 'worktrees', 'memory', 'null', 'claude-501', 'fixtures', 'daemon', 'hooks', 'skills', '.', '..', '~']);
const BASH_SAFE = [/^npm test$/, /^npm run [\w:-]{1,30}$/, /^swift test$/, /^swift build$/, /^git status( -s| --short)?$/, /^git diff( --stat)?$/, /^ls( -la?)?$/, /^sleep \d+$/, /^npx vitest( run)?( --[\w-]+)*$/];
const KEEP_LINES = [/^\(Bash completed with no output\)$/, /^\[exited with code \d+\]$/, /^(Error: )?Exit code \d+$/, /^\[Request interrupted by user( for tool use)?\]$/, /^The user doesn't want to proceed with this tool use\./, /^Structured output provided successfully$/, /^\[Image: original \d+x\d+, displayed at \d+x\d+\..*\]$/, /^<local-command-caveat>The command below was run directly in Claude Code[^<]*<\/local-command-caveat>$/, /^<event>\[Monitor expired after [^\]]*\]<\/event>$/, /^Waited for \d+ seconds?$/, /^Updated task #\d+ status$/, /^No (files|matches) found$/, /^The server returned HTTP \d{3} [A-Za-z ]+\.$/, /^<system-reminder>Warning: the file exists but the contents are empty\.<\/system-reminder>$/, /^User rejected tool use$/, /^(Output too large|Full output saved to)\b.{0,12}$/];
const TAGS = new Set(['system-reminder', 'command-name', 'command-message', 'command-args', 'local-command-stdout', 'local-command-stderr', 'local-command-caveat', 'task-notification', 'task-id', 'tool-use-id', 'output-file', 'status', 'summary', 'result', 'usage', 'subagent_tokens', 'tool_uses', 'duration_ms', 'tool_use_error', 'persisted-output', 'event', 'cross-session-message', 'tools-used-before-summary', 'agent-message', 'bash-input', 'bash-stdout', 'bash-stderr', 'user-prompt-submit-hook', 'total_tokens']);
const TAG_SPLIT = new RegExp(`(<\\/?(?:${[...TAGS].join('|')})(?:\\s[^<>]*)?>)`);
const BUILTIN_COMMANDS = new Set(['/clear', '/compact', '/model', '/help', '/context', '/config', '/status', '/cost', '/resume', '/init', '/mcp', '/agents', '/login', '/logout', '/plugin', '/memory', '/effort', '/exit', '/fast', '/permissions', '/doctor', '/review', '/usage', '/export', '/rewind', '/loop', '/schedule']);
const RE = {
  uuid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
  uuidWhole: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  prefixedId: /^(toolu_|msg_|req_|srvtoolu_|wf_|agent-|ref_)[A-Za-z0-9_-]{6,}$/,
  hexId: /^a?[0-9a-f]{16}$/,
  iso: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/,
  url: /^https?:\/\/\S+$/,
  timeKey: /(time|At|stamp|until|expire|date)/i,
  mdPrefix: /^(\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*|\d+[\t\u2192]|\s*\d+\t))/,
};

const sha = (s) => crypto.createHash('sha256').update(s).digest();
function rng(seed) {
  let a = sha(seed).readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createAnonymiser({ maxChars = Infinity } = {}) {
  const memo = new Map();
  const remember = (ns, key, make) => {
    const k = ns + '\0' + key;
    if (!memo.has(k)) memo.set(k, make());
    return memo.get(k);
  };
  const counters = {};
  const nextCount = (ns) => (counters[ns] = (counters[ns] || 0) + 1);

  function mapId(s) {
    return remember('id', s, () => {
      const m = s.match(/^(toolu_|msg_|req_|srvtoolu_|wf_|agent-|ref_)/);
      const prefix = m ? m[1] : '';
      const body = s.slice(prefix.length);
      const hexOnly = /^[0-9a-f-]+$/.test(body);
      const r = rng('id:' + s);
      const pick = (chars) => chars[Math.floor(r() * chars.length)];
      return prefix + [...body].map((ch) => {
        if (/[0-9]/.test(ch)) return pick('0123456789');
        if (hexOnly && /[a-f]/.test(ch)) return pick('abcdef');
        if (/[a-z]/.test(ch)) return pick('abcdefghijklmnopqrstuvwxyz');
        if (/[A-Z]/.test(ch)) return pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
        return ch;
      }).join('');
    });
  }
  const mapIdsInString = (s) => s.replace(RE.uuid, mapId).replace(/agent-a[0-9a-f]{16}/g, mapId).replace(/\ba[0-9a-f]{16}\b/g, mapId);

  const projectName = (real) => remember('proj', real, () => {
    const n = nextCount('proj');
    const base = NEUTRAL_PROJECTS[(n - 1) % NEUTRAL_PROJECTS.length];
    return n <= NEUTRAL_PROJECTS.length ? base : `${base}-${Math.ceil(n / NEUTRAL_PROJECTS.length)}`;
  });

  const devNames = (fs.existsSync(path.join(HOME, 'dev')) ? fs.readdirSync(path.join(HOME, 'dev')) : []).sort((a, b) => b.length - a.length);
  const encodeName = (n) => n.replace(/[^A-Za-z0-9]/g, '-');
  function mapEncodedCwd(seg) {
    const afterUser = seg.replace(/^-Users-[^-]+-/, '');
    const inDev = afterUser.startsWith('dev-');
    const rest = inDev ? afterUser.slice(4) : afterUser;
    const real = devNames.find((n) => rest === encodeName(n) || rest.startsWith(encodeName(n) + '-')) ?? rest.split('-')[0];
    const tail = rest.slice(encodeName(real).length);
    return '-Users-dev-' + (inDev ? 'dev-' : '') + projectName(real) + (/^--claude-worktrees-/.test(tail) ? '--claude-worktrees-wt' : '');
  }

  function mapSegment(seg, prevSeg, isLast) {
    if (KNOWN_SEGMENTS.has(seg) || /^[*?{}\[\]!,.*]+$/.test(seg)) return seg;
    if (/^(Users)$/.test(prevSeg) || prevSeg === 'home') return 'dev';
    if (prevSeg === 'dev') return projectName(seg);
    if (/^-Users-/.test(seg)) return remember('enc', seg, () => mapEncodedCwd(seg));
    const idMapped = mapIdsInString(seg);
    if (idMapped !== seg || RE.prefixedId.test(seg)) return mapIdsInString(idMapped);
    return remember('seg', seg, () => {
      const n = nextCount('seg');
      const ext = (seg.match(/(\.[A-Za-z0-9]{1,6})$/)?.[1] || '').replace(/^\.(at|com|de|net|org|io|ai|eu|li|app|dev|lan|local)$/i, '');
      if (!ext) return isLast ? `item${n}` : `dir${n}`;
      const stem = { '.swift': 'File', '.ts': 'module', '.tsx': 'module', '.js': 'module', '.mjs': 'module', '.md': 'notes' }[ext] || 'file';
      return `${stem}${n}${ext}`;
    });
  }
  function mapPath(p) {
    const s = p.split(HOME).join('/Users/dev').split('/Users/' + USER).join('/Users/dev').replace(/\/home\/[^/]+/g, '/home/dev');
    const segs = s.split('/');
    return segs.map((seg, i) => mapSegment(seg, segs[i - 1] ?? '', i === segs.length - 1)).join('/');
  }
  const looksLikePath = (s) => !s.includes('\n') && s.length < 1000 && /^(\/|~\/)[^\s/][^/]*\//.test(s) && (!/\s/.test(s) || s.includes(HOME));

  function shiftIso(s) {
    const d = new Date(Date.parse(s) + TIME_OFFSET_MS);
    return /\.\d+Z$/.test(s) ? d.toISOString() : d.toISOString().replace(/\.\d+Z$/, 'Z');
  }

  function fillText(len, r, slug) {
    let out = '';
    while (out.length < len) out += WORDS[Math.floor(r() * WORDS.length)] + (slug ? '-' : ' ');
    out = out.slice(0, len);
    return out.replace(/[\s-]+$/, (m) => 'x'.repeat(m.length));
  }

  function fillLine(line, state, r, diff) {
    if (KEEP_LINES.some((re) => re.test(line))) return line;
    if (diff && /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(line)) return line.replace(/(@@ [^@]*@@).*/, (m, h) => h + ' ' + fillText(m.length - h.length - 1, r, false)).replace(/ $/, '');
    if (diff && /^(---|\+\+\+) \S/.test(line)) return line.slice(0, 4) + mapPath(line.slice(4));
    if (!/[A-Za-z0-9]/.test(line) || (line.length <= 8 && !/[A-Za-z0-9]{3}/.test(line))) return line;
    const fence = line.match(/^(\s*```)([a-z]{1,12})?\s*$/);
    if (fence) return fence[0];
    let head = '';
    if (diff && /^[+\- ]/.test(line)) head = line[0];
    const body = line.slice(head.length);
    const lead = body.match(/^\s*/)[0];
    const md = body.slice(lead.length).match(RE.mdPrefix);
    const prefix = head + lead + (md ? md[0].replace(/^\s+/, '') : '');
    return fillTagged(line.slice(prefix.length), prefix, state, r);
  }

  function fillTagged(rest, prefix, state, r) {
    const parts = rest.split(TAG_SPLIT);
    let out = prefix;
    for (const part of parts) {
      const tag = part.match(/^<(\/?)([a-z][a-z0-9_-]*)(?:\s[^<>]*)?>$/);
      if (tag && TAGS.has(tag[2])) {
        if (tag[1]) state.open = state.open.filter((t, i, a) => i < a.lastIndexOf(tag[2]));
        else state.open.push(tag[2]);
        out += part.replace(/(\s[\w-]+=)(["'])[^"']*\2/g, '$1$2x$2');
      } else if (part) out += tagContent(part, state.open[state.open.length - 1], r);
    }
    return out;
  }
  function tagContent(text, tag, r) {
    if (tag === 'status' && /^[a-z_]+$/.test(text)) return text;
    if (tag === 'tool_uses' || tag === 'duration_ms' || tag === 'subagent_tokens' || tag === 'total_tokens') return text;
    if (tag === 'task-id' || tag === 'tool-use-id') return mapId(text);
    if (tag === 'output-file') return mapPath(text);
    if (tag === 'command-message' && BUILTIN_COMMANDS.has('/' + text)) return text;
    if (tag === 'command-name') return BUILTIN_COMMANDS.has(text) ? text : '/custom-command';
    return fillText(text.length, r, false);
  }

  function filler(text, key) {
    if (text.length === 0) return text;
    const r = rng('fill:' + text);
    if (!/\s/.test(text) && /^[\w.@-]+$/.test(text) && text.length <= 80) return fillText(text.length, r, true);
    const diff = key === 'lines[]' || /^@@ -\d/m.test(text);
    const state = { open: [] };
    const lines = text.split('\n');
    const out = [];
    let size = 0;
    for (const line of lines) {
      const f = fillLine(line, state, r, diff);
      out.push(f);
      size += f.length + 1;
      if (size >= maxChars) break;
    }
    return out.join('\n');
  }

  function bashCommand(cmd) {
    const wrapped = cmd.trim().match(/^(?:cd (\S+) && )?(.+?)((?: 2>&1)?(?: \| (?:tail|head) -\d+)?)$/s);
    if (wrapped && BASH_SAFE.some((re) => re.test(wrapped[2]))) return (wrapped[1] ? `cd ${mapPath(wrapped[1])} && ` : '') + wrapped[2] + wrapped[3];
    return remember('cmd', cmd, () => `echo step-${nextCount('cmd')}`);
  }

  function anonString(s, key, parent) {
    if (s === '') return s;
    if (key === 'signature') return '';
    if ((key === 'data' && parent?.type === 'base64') || (key === 'base64' && s.length > 64)) return PLACEHOLDER_PNG;
    if (key === 'name' && (['tool_use', 'server_tool_use', 'tool_reference'].includes(parent?.type) || 'input_schema' in (parent || {}))) return s;
    if (AGENT_KEYS.has(key)) return BUILTIN_AGENTS.has(s) ? s : remember('agent', s, () => `custom-agent-${nextCount('agent')}`);
    if (key === 'attributionSkill' || key === 'skill') return remember('skill', s, () => `custom-skill-${nextCount('skill')}`);
    if (KEEP_KEYS.has(key) && s.length <= 80 && (!/\s/.test(s) || SPACE_OK.has(key)) && !s.includes(HOME)) return s;
    if (key === 'command' || key === 'cmd') return BUILTIN_COMMANDS.has(s) ? s : bashCommand(s);
    if (key === 'commandName') return BUILTIN_COMMANDS.has(s) ? s : '/custom-command';
    if (key === 'gitBranch' || key === 'branch') return /^(main|master|HEAD)$/.test(s) ? s : remember('br', s, () => `branch-${nextCount('br')}`);
    if (/^(true|false)$/.test(s)) return s;
    if (RE.iso.test(s)) return shiftIso(s);
    if (/^\d{4}-\d\d-\d\d$/.test(s)) return shiftIso(s + 'T12:00:00Z').slice(0, 10);
    if (RE.uuidWhole.test(s) || RE.prefixedId.test(s) || RE.hexId.test(s)) return mapId(s);
    if (/^\d{1,4}$/.test(s)) return s;
    if (ID_KEY.test(key) && /^[A-Za-z0-9@._-]{6,80}$/.test(s)) return mapId(s);
    if (/^[^\s@]+@[\w.-]+\.\w+$/.test(s)) return 'user@example.com';
    if (RE.url.test(s)) return 'https://example.com/' + fillText(Math.max(s.length - 20, 1), rng(s), true);
    if (PATH_KEYS.has(key) || looksLikePath(s)) return mapPath(s);
    if (key === 'pattern' && /^[\w*?./{},-]+$/.test(s) && /[*/]/.test(s)) return mapPath(s);
    if (/^[[{]/.test(s.trim()) && s.length > 1) {
      try { return JSON.stringify(anon(JSON.parse(s), key, parent)); } catch { /* not JSON: fall through to filler */ }
    }
    return filler(s, key);
  }

  function anonKey(k, parentKey) {
    if (parentKey === 'trackedFileBackups' || /[/\\]/.test(k) || /\.[A-Za-z0-9]{1,6}$/.test(k)) return mapPath(k);
    if (RE.uuidWhole.test(k) || RE.hexId.test(k) || RE.prefixedId.test(k)) return mapId(k);
    if (/^[A-Za-z_$][\w$.:@-]*$/.test(k) && k.length <= 80) return k;
    return filler(k, 'key');
  }

  function anon(v, key = '', parent = null) {
    if (typeof v === 'string') return anonString(v, key, parent);
    if (typeof v === 'number') return Number.isInteger(v) && RE.timeKey.test(key) && v > 1.6e12 && v < 2.1e12 ? v + TIME_OFFSET_MS : v;
    if (Array.isArray(v)) return v.map((x) => anon(x, key + '[]', parent));
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[anonKey(k, key)] = anon(x, k, v);
      return out;
    }
    return v;
  }
  return { anon, setMaxChars: (n) => { maxChars = n; } };
}

export function selectKept(lines) {
  const parsed = lines.filter(Boolean).map((l) => JSON.parse(l));
  const best = new Map();
  parsed.forEach((o, i) => {
    if (!API_TYPES.has(o.type)) return;
    const size = JSON.stringify(o).length;
    if (!best.has(o.type) || size < best.get(o.type).size) best.set(o.type, { i, size });
  });
  const dropped = {};
  const kept = parsed.filter((o, i) => {
    if (!API_TYPES.has(o.type) || best.get(o.type).i === i) return true;
    dropped[o.type] = (dropped[o.type] || 0) + 1;
    return false;
  });
  return { kept, dropped };
}

export function anonymiseLines(lines, opts = {}) {
  const { anon } = opts.anonymiser ?? createAnonymiser(opts);
  const { kept, dropped } = selectKept(lines);
  return { out: kept.map((o) => JSON.stringify(anon(o))), dropped };
}

// Words that are real folder names on this machine but also ordinary English or vendor words that
// appear in Claude Code's own boilerplate (tool descriptions, schemas). They are exempt from the
// token check only; every other real folder name, user name and host name is forbidden.
const COMMON_WORDS = new Set(TERMS.commonWords);
const SUBSTRING_TERMS = [USER, path.basename(HOME), ...TERMS.forbiddenSubstrings];
const FOLDER_PREFIX = new RegExp('^(' + TERMS.folderPrefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')-');

export function forbiddenTokens() {
  const tokens = new Set(os.hostname().split('.').filter((x) => x.length > 3));
  const prefix = '-Users-' + USER + '-';
  const names = [];
  const projects = path.join(HOME, '.claude', 'projects');
  if (fs.existsSync(projects)) for (const d of fs.readdirSync(projects)) names.push(d.startsWith(prefix) ? d.slice(prefix.length) : d);
  const dev = path.join(HOME, 'dev');
  if (fs.existsSync(dev)) names.push(...fs.readdirSync(dev));
  for (const n of names) {
    const base = n.replace(FOLDER_PREFIX, '');
    if (/^[A-Za-z][A-Za-z0-9-]{5,}$/.test(base) && !COMMON_WORDS.has(base.toLowerCase()) && !NEUTRAL_PROJECTS.includes(base)) tokens.add(base);
  }
  return [...tokens];
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const VALUE_CHECKS = [
  ['email', /[\w.+-]+@(?!example\.com)[\w-]+\.[\w.-]+/],
  ['url-host', /https?:\/\/(?!example\.com)[^/\s"'\\]+/],
  ['ipv4', /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
  ['hostname', /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|at|de|eu|ai|app|dev|li|lan|local|ts\.net)\b(?<!example\.com)/i],
  ['token', /sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{10,}|gho_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}|-----BEGIN/],
  ['long-hex', /[A-Fa-f0-9]{33,}/],
  ['long-base64', /[A-Za-z0-9+=]{33,}/],
  ['foreign-home', /\/(Users|home)\/(?!dev\b)[A-Za-z][\w.-]*/],
];
const HASH_KEY = /(hash|digest)/i;

function* walkStrings(v, key) {
  if (typeof v === 'string') yield { text: v, key, isKey: false };
  else if (Array.isArray(v)) for (const x of v) yield* walkStrings(x, key);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { yield { text: k, key: k, isKey: true }; yield* walkStrings(x, k); }
}

export function verifyText(text) {
  const hits = [];
  const tokenRes = forbiddenTokens().map((t) => [t, new RegExp(`(?<![A-Za-z0-9_])${escapeRe(t)}(?![A-Za-z0-9_])`, 'i')]);
  const subRes = SUBSTRING_TERMS.map((t) => [t, new RegExp(escapeRe(t), 'i')]);
  text.split('\n').forEach((line, i) => {
    if (!line) return;
    let items;
    try { items = [...walkStrings(JSON.parse(line), '')]; } catch { items = [{ text: line, key: '', isKey: false }]; }
    for (const { text: raw, key, isKey } of items) {
      const t = raw.split(PLACEHOLDER_PNG).join('');
      if (!isKey) for (const [name, re] of VALUE_CHECKS) {
        if ((name === 'long-hex' || name === 'long-base64') && HASH_KEY.test(key)) continue;
        const m = t.match(re);
        if (m) hits.push({ line: i + 1, kind: name, sample: m[0].slice(0, 60) });
      }
      for (const [term, re] of [...tokenRes, ...subRes]) if (re.test(t)) hits.push({ line: i + 1, kind: 'term', sample: term });
    }
  });
  return hits;
}

function main(argv) {
  if (argv[0] === '--verify') {
    let bad = 0;
    for (const f of argv.slice(1)) {
      const hits = verifyText(fs.readFileSync(f, 'utf8'));
      console.log(`${f}: ${hits.length} hits`);
      for (const h of hits.slice(0, 20)) console.log(`  line ${h.line} ${h.kind}: ${h.sample}`);
      bad += hits.length;
    }
    process.exit(bad ? 1 : 0);
  }
  const [input, output] = argv;
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const range = flag('--lines')?.split('-').map(Number);
  let lines = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean);
  if (range) lines = lines.slice(range[0] - 1, range[1]);
  const { out, dropped } = anonymiseLines(lines, { maxChars: Number(flag('--max-chars') || Infinity) });
  fs.writeFileSync(output, out.join('\n') + '\n');
  console.log(JSON.stringify({ input: path.basename(input), sourceLines: lines.length, outLines: out.length, dropped }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main(process.argv.slice(2));
