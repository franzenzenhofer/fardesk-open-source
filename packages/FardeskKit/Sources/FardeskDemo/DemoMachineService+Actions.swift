import FardeskClient
import FardeskModels
import Foundation

/// What the demo does when the user acts: every change stays in memory and the pretend Claude answers with one canned line.
extension DemoMachineService {
    func message(sessionID: String, text: String, attachments: [String]?) async throws -> MessageResult {
        let current = try world.record(sessionID, on: machineKey).summary
        guard current.replyMode == .composer else { throw DemoWorld.conflict("This session has ended. Resume it first.") }
        let user = try world.row("user", id: world.newID("demo-user"), ["text": text])
        try world.working(sessionID, on: machineKey, adding: [user])
        return MessageResult(queued: nil)
    }

    func stop(sessionID: String) async throws {
        try world.change(sessionID, on: machineKey, patch: ["status": "idle", "canStop": false])
    }

    func kill(sessionID: String, closeTab: Bool) async throws -> KillResult {
        try world.change(sessionID, on: machineKey, patch: ["status": "ended", "waitingFor": NSNull(), "canStop": false, "owned": false, "replyMode": "resume"])
        return try DemoJSON.decode(from: ["ok": true, "closed": "none"])
    }

    func resume(sessionID: String) async throws -> ActionResult {
        try world.change(sessionID, on: machineKey, patch: ["status": "idle", "owned": true, "replyMode": "composer"])
        return try result(sessionID)
    }

    func takeover(sessionID: String) async throws -> ActionResult {
        try world.change(sessionID, on: machineKey, patch: ["owned": true, "replyMode": "composer"])
        return try result(sessionID)
    }

    func fork(sessionID: String) async throws -> ActionResult {
        let source = try world.record(sessionID, on: machineKey)
        return try result(startSession(from: source, title: "\(source.summary.title) (fork)", keepingRows: true).summary.id)
    }

    func clear(sessionID: String) async throws -> ActionResult {
        let source = try world.record(sessionID, on: machineKey)
        return try result(startSession(from: source, title: source.summary.title, keepingRows: false).summary.id)
    }

    func compact(sessionID: String) async throws -> ActionResult {
        let note = try world.row("system", id: world.newID("demo-compact"), ["text": "Conversation compacted"])
        try world.change(sessionID, on: machineKey, patch: ["status": "idle"], adding: [note])
        return try result(sessionID)
    }

    func mute(sessionID: String, muted: Bool) async throws {
        try world.change(sessionID, on: machineKey, patch: ["muted": muted])
    }

    func label(sessionID: String, _ request: LabelRequest) async throws {
        var label = try DemoJSON.dictionary(world.record(sessionID, on: machineKey).summary.label)
        if let name = request.name { label["name"] = DemoJSON.orNull(name) }
        if let color = request.color { label["color"] = DemoJSON.orNull(color?.hex) }
        if let pinned = request.pinned { label["pinned"] = pinned }
        try world.change(sessionID, on: machineKey, patch: ["label": label])
    }

    // The demo is read-only (every session action is greyed out there): nothing is ever hidden.
    func hide(sessionID: String) async throws { throw DemoWorld.conflict("The demo does not change its list.") }
    func unhide(sessionID: String) async throws { throw DemoWorld.conflict("The demo does not change its list.") }
    func hiddenSessions() async throws -> [HiddenSession] { [] }

    func decide(sessionID: String, requestID: String, decision: PermissionDecision, message: String?) async throws {
        let pending = try pendingRow(sessionID, requestID: requestID, kind: "permission")
        var fields = try DemoJSON.dictionary(pending)
        fields["state"] = decision == .deny || decision == .revise ? "denied" : "allowed"
        try world.working(sessionID, on: machineKey, replacing: DemoJSON.decode(Activity.self, from: fields))
    }

    func answer(sessionID: String, requestID: String, option: String) async throws {
        let pending = try pendingRow(sessionID, requestID: requestID, kind: "question")
        var fields = try DemoJSON.dictionary(pending)
        fields["state"] = "answered"
        try world.working(sessionID, on: machineKey, replacing: DemoJSON.decode(Activity.self, from: fields))
    }

    func answerDialog(sessionID: String, requestID: String, answer: String) async throws {
        throw DemoWorld.conflict("The demo has no Claude Code dialogs.")
    }

    func newSession(_ request: NewSessionRequest) async throws -> ActionResult {
        let id = world.newID("demo-session")
        let now = DemoJSON.iso(world.clock())
        let title = String(request.prompt.prefix(60))
        let summary: SessionSummary = try DemoJSON.decode(from: [
            "id": id, "title": title, "cwd": request.cwd, "status": "idle", "waitingFor": NSNull(), "owned": true, "replyMode": "composer",
            "canStop": false, "summary": "", "model": DemoJSON.orNull(request.model), "pid": NSNull(), "muted": false,
            "permissionMode": (request.permissionMode?.rawValue ?? "default") as Any, "contextTokens": NSNull(), "cacheExpiresAt": NSNull(), "lastTurnAt": NSNull(),
            "startedAt": now, "updatedAt": now, "label": ["name": NSNull(), "color": NSNull(), "pinned": false],
            "agent": "claude", "background": 0, "home": DemoJSON.orNull(request.home ?? "Personal"),
            "autoColor": nextAutoColour().hex,
        ])
        world.insert(DemoFixture.SessionRecord(machine: machineKey, summary: summary, activities: [], details: [:]))
        let prompt = try world.row("user", id: world.newID("demo-user"), ["text": request.prompt])
        try world.working(id, on: machineKey, adding: [prompt])
        return try result(id)
    }

    // MARK: Helpers

    /// The first preset no session of this machine shows yet (the real daemon picks the farthest one; the demo only needs a distinct one).
    private func nextAutoColour() -> LabelColor {
        let shown = Set(world.sessions(of: machineKey).compactMap { $0.label.color ?? $0.autoColor })
        let free = LabelPalette.presets.first { !shown.contains($0.color) } ?? LabelPalette.presets[0]
        return free.color
    }

    private func result(_ sessionID: String) throws -> ActionResult {
        try DemoJSON.decode(from: ["sessionId": sessionID])
    }

    private func pendingRow(_ sessionID: String, requestID: String, kind: String) throws -> Activity {
        let rows = try world.record(sessionID, on: machineKey).activities
        for row in rows {
            switch row {
            case .permission(let found) where kind == "permission" && found.requestId == requestID && found.state == .pending: return row
            case .question(let found) where kind == "question" && found.requestId == requestID && found.state == .pending: return row
            default: continue
            }
        }
        throw DemoWorld.conflict("This request was already answered.")
    }

    private func startSession(from source: DemoFixture.SessionRecord, title: String, keepingRows: Bool) throws -> DemoFixture.SessionRecord {
        let id = world.newID("demo-session")
        let now = DemoJSON.iso(world.clock())
        let summary = try DemoJSON.patched(source.summary, [
            "id": id, "title": title, "status": "idle", "waitingFor": NSNull(), "canStop": false, "startedAt": now, "updatedAt": now,
            "owned": true, "replyMode": "composer",
        ])
        let rows = keepingRows ? source.activities.filter { !isPending($0) } : []
        let record = DemoFixture.SessionRecord(machine: machineKey, summary: summary, activities: rows, details: keepingRows ? source.details : [:])
        world.insert(record)
        return record
    }

    private func isPending(_ row: Activity) -> Bool {
        switch row {
        case .permission(let request): request.state == .pending
        case .question(let request): request.state == .pending
        case .dialog(let request): request.isPending
        default: false
        }
    }
}
