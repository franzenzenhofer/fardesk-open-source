# Versions and compatibility

Fardesk 4 is the line that goes public. From the first public release on, an app and a daemon of the same major
version always work together, in any combination of older and newer: a phone can be updated before its machines,
a machine before the phone, and one machine before another. Nothing breaks; at most a new feature waits until the
machine that has to do it is updated, and the app says so and offers the update with one tap.

## 1. One number, three meanings

- `VERSION` (`4.2.0`): the release. The same number ships on every output of a release (daemon, CLI, apps).
- Major (`4`): the compatibility line. Every app 4.x works with every daemon 4.x.
- `contractVersion` in `GET /v1/machine` is the major (`4`). It changes only with the major.

## 2. Inside a major: only additions

Allowed in 4.x:

- a new field in an answer (old apps ignore it);
- a new optional field in a request (old daemons ignore it, see 3);
- a new route, a new enum value, a new feature name.

Example, 4.2: Claude Code's own dialogs. New activity kind `dialog`, new `waitingFor` value `dialog`, new route
`POST /v1/sessions/:id/dialog/:requestId`, new feature `claude-dialogs`; nothing existing changed (see "Claude Code dialogs" in
DAEMON.md). An older app that does not know the kind skips the activity (3) and sees the session as waiting; the machine row
offers **Update** for apps and daemons without the feature.

Never in 4.x: removing or renaming a field, a route or an enum value; changing a field's type or meaning; making an
optional field required. A change of that kind waits for the next major.

## 3. Both sides read tolerantly

- **Daemon:** request bodies are parsed with `z.object` (unknown keys are dropped), never `z.strictObject`; the hub
  also reads a peer's `/v1/machine` with unknown keys dropped. A newer
  app may send a field an older daemon does not know: the daemon ignores it. The app never relies on that (see 4).
- **App:** unknown keys in answers are ignored. Every field added after 4.2.0 is optional in the app's model. Every
  enum the daemon sends has an `unknown` case (a status, a reason, an agent kind, an activity kind that a newer
  daemon added), shown neutrally ("Unknown state, update the app") instead of failing the whole list.
- **Tests:** `CompatibilityTests` decode every fixture with extra unknown fields and unknown enum values added; a
  daemon test posts every request with an unknown extra field. Both must pass.

## 4. Features, not version numbers

`GET /v1/machine` lists what the daemon can do: `features: ["chat-image", "self-update", ...]`. The app decides by
feature, never by comparing version numbers: no "Image" section for a machine without `chat-image`, but a line
"Update <machine> to give chats an image" with the Update button. Feature names are added, never removed or reused
inside a major.

## 5. The lifeline: always able to update

Three things never change their shape, in any major, so any app can update any daemon it can reach:

| Route | Answer |
|---|---|
| `GET /v1/machine` | at least `contractVersion`, `version`, `features`, `update`: `{ state: idle \| running \| failed \| done, message, version, packageSha256, at }` (the last update; `message` = why it failed, `version` = the version it installs, `packageSha256` = SHA-256 of this machine's own package) |
| `GET /v1/update/package` | this machine's own installed release package (the same tarball `deploy.sh` installs, kept as `<install dir>/release.tgz`), `application/gzip`; 404 `not_found` when the install has none |
| `POST /v1/machine/update` | body: a release package (at most 20 MB), header `X-Fardesk-Package-Sha256`; 400 on a wrong hash or a body that is no release, 409 while an update runs; otherwise answers `{ ok: true, state: "running" }` at once, installs it in a background process that survives the service restart, and `update.state` tells the rest |

How an update spreads (push, so no machine needs credentials for another):

1. One machine gets the new release the normal way (owner deploy, or later the npm package / install script).
2. Every app and the coordinator see that the others run an older version (Settings > Machines shows each machine's
   version; a line "2 machines can be updated" with **Update all**).
3. **Update all** (app via `POST /v1/hub/update-all`, or coordinator tool `update_machines`): the hub (it holds a
   token for every machine) fetches the package from the newest machine and posts it to each older one, itself last.
   It answers `{ source, version, machines: [{ name, from, result: started | current | failed, message }] }`. Without
   a hub the app does the same relay itself (about 2 MB per machine). Each machine checks the SHA-256, installs,
   restarts through launchd or systemd; the app shows each machine's progress until its version changes (`update.state`
   `running`, then `done` once the new daemon runs, or `failed`). A failed install says why in `update.message` (the
   last line of the installer log).

Trust: the package comes from a paired machine of the same tailnet over Tailscale, like every other call; only a
holder of that machine's token (the paired phone, its hub) can post one, and the hash is checked before installing.

## 6. The app is older than a daemon

A daemon lists `minAppVersion` in `/v1/machine` only when a feature it is about to rely on needs it. Inside a major
this stays empty, because of 2 and 3. When the app sees a daemon of a newer major, it shows "This machine runs
Fardesk 5. Update the app." and keeps using the lifeline only.

## 7. The next major

A daemon 5 keeps serving contract 4 on `/v1` for the whole of major 5, and the new shapes under `/v2`. An app 5
talks `/v2` to daemons of contract 5; to a daemon of contract 4 it shows that machine with **Update** only (the
lifeline). So mixed fleets keep working during the move, and every old machine is one tap from the new version.
