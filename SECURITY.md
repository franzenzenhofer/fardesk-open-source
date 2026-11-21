# Security

## Reporting a problem

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on the repository's
Security tab (private vulnerability reporting): https://github.com/franzenzenhofer/fardesk-open-source/security
Do not open a public issue for a vulnerability. We will answer within 7 days and tell you when a fix is
released. Please give us 90 days before you publish details.

## Trust model

One user, one tailnet. Every computer and the phone belong to the same person. Any valid bearer token can start
a Claude Code session in any folder with any prompt. That is a remote shell as the daemon's user, by design. All
other rules below exist to keep that token in the right hands.

## What protects it

| Topic | Behaviour |
|---|---|
| Network | The daemon binds to the Tailscale address or loopback. Another address needs TLS and `bind.allowNonTailnet: true`; otherwise it exits with an error. |
| Pairing | The QR code and link carry a one-time code (32 random bytes, valid 2 minutes, used once, kept in memory, compared in constant time; open only while `fardeskd pair` runs; five wrong codes close the window and write an audit line). The app swaps it for its own device token. Before the code is checked, the daemon asks Tailscale who is calling and refuses (403, audited) any device that is not of the same tailnet user as this computer (login and pairing through a hub get the same check; a reverse proxy on this computer would make every caller look local, so none belongs in front of the daemon); `pairing.allowedUsers` and `pairing.allowedTags` widen this on purpose. |
| Device tokens | Stored as SHA-256 on the daemon. Each device can be revoked (`fardeskd revoke`) and gets a wipe push. Stored in the Keychain on the phone, available after first unlock, not synced. |
| Password | Optional. scrypt, constant-time compare, minimum 12 characters, 5 failures per 300 seconds per address, failures are logged. |
| Browser attacks | Every route needs an `Authorization` header and there are no cookies, so a web page cannot act with your rights. |
| Permission prompts | On by default for sessions started from the phone. `bypassPermissions` needs `owned.allowBypass: true`. |
| Coordinator | Off by default. When on: default permission mode, a limited tool set unless `coordinator.fullTools: true`, and it may approve requests only with `coordinator.mayApprove: true`. Session output is treated as untrusted. |
| Push | Generic text by default. `push.content: "full"` sends session text through Apple's push servers. Push is off unless you configure an APNs key. |
| Attachments | Uploads have a hard size limit and a per-session quota; files are read back only if they are regular files the daemon stored itself. |
| Audit log | `audit.jsonl` in the state folder: time, device, route, session id, no message text. Requests without a valid token go to `audit-unauthenticated.jsonl`, so they cannot push the trail out. `fardeskd audit` prints both. |
| Diagnostics | Written to a local file only. Nothing is sent to the authors. `diagnostics.enabled: false` turns it off. |
| Hooks | `install-hooks` shows the change to `~/.claude/settings.json`, writes a backup, edits atomically, and removes only its own entries. The hook socket is mode 0600 in a 0700 folder, and the hook command never blocks Claude Code. |
| Files | The config and token files are mode 600 in a 700 folder. |

## Known limits

- **The hub is the crown jewel.** A hub holds a token for every machine it manages, and anything the hub can
  reach, a token of the hub can do on those machines. Until per-hub link tokens exist, treat the hub as the
  machine to protect most: full-disk encryption, no other users, no untrusted software.
- **Plain HTTP inside the tunnel.** Between your devices WireGuard (Tailscale) encrypts the path. The app has an
  App Transport Security exception because that setting cannot allow an IP range. On a shared tailnet this is
  not enough; use the access rule below and TLS.
- **Prompt injection.** Any text a session reads (a web page, a repository's README) can try to instruct Claude
  Code. With bypass mode or the Coordinator on, a successful injection has the same reach as your token.
- **Sessions inherit the daemon's environment.** A secret in the daemon's environment reaches every session it
  starts.
- **Undocumented Claude Code files.** Fardesk reads Claude Code's local transcript and registry files. They can
  change in any release.
- **The fixtures are structure only.** Transcript fixtures contain no real text; see the INDEX next to them.

## Tailscale access rule (if your tailnet has other people)

Limit port 4780 to your own devices. In the Tailscale admin console under Access controls, with your own user
and tags:

```json
{
  "grants": [
    { "src": ["you@example.com"], "dst": ["tag:fardesk"], "ip": ["tcp:4780"] }
  ],
  "tagOwners": { "tag:fardesk": ["you@example.com"] }
}
```

Tag each machine that runs `fardeskd` with `tag:fardesk`. Syntax reference:
https://tailscale.com/docs/reference/syntax/policy-file

## Undo

`fardeskd uninstall-hooks`, remove the service, `fardeskd revoke --all`, delete `~/.config/fardesk`.
