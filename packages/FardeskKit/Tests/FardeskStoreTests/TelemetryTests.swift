import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

private func report(_ message: String, area: String = "feed", at seconds: TimeInterval = 0) -> TelemetryReport {
    TelemetryReport(
        at: Date(timeIntervalSince1970: 1_800_000_000 + seconds), message: message, area: area,
        appVersion: "1", build: "2", platform: "test"
    )
}

/// A paired machine nobody answers for (port 9 refuses connections).
private func pairDeadMachine(in sandbox: StoreSandbox) throws -> MachineEndpoint {
    let endpoint = MachineEndpoint(name: "dead", url: URL(string: "http://127.0.0.1:9")!)
    try sandbox.machinesFile.save(MachineList(endpoints: [endpoint]))
    try sandbox.keychainTokens.save("x", endpoint.id)
    return endpoint
}

private func temporaryFile() -> URL {
    URL(filePath: "/tmp", directoryHint: .isDirectory)
        .appending(path: "fds-queue-\(UUID().uuidString.prefix(8)).json")
}

struct TelemetryQueueTests {
    @Test func queuedReportsSurviveARestart() {
        let file = temporaryFile()
        let first = TelemetryQueue(file: file)
        #expect(first.enqueue(report("one")))
        #expect(first.enqueue(report("two")))
        #expect(TelemetryQueue(file: file).isEmpty, "nothing is written on the calling thread")
        first.flushToDisk()
        let second = TelemetryQueue(file: file)
        #expect(second.pending.map(\.message) == ["one", "two"])
        second.remove(ids: [second.pending[0].id])
        second.flushToDisk()
        #expect(TelemetryQueue(file: file).pending.map(\.message) == ["two"])
    }

    @Test func theSameErrorIsNotQueuedTwiceWithinTheRepeatWindow() {
        let queue = TelemetryQueue(file: nil)
        #expect(queue.enqueue(report("boom", at: 0)))
        #expect(!queue.enqueue(report("boom", at: 10)))
        #expect(queue.enqueue(report("boom", area: "reply", at: 10)))
        #expect(queue.enqueue(report("boom", at: TelemetryQueue.repeatWindow + 1)))
        #expect(queue.pending.count == 3)
    }

    @Test func theQueueKeepsTheNewestReportsOnly() {
        let queue = TelemetryQueue(file: nil)
        for index in 0..<(TelemetryQueue.capacity + 5) {
            queue.enqueue(report("error \(index)", at: Double(index) * 100))
        }
        #expect(queue.pending.count == TelemetryQueue.capacity)
        #expect(queue.pending.first?.message == "error 5")
        #expect(queue.pending.last?.message == "error \(TelemetryQueue.capacity + 4)")
    }

    @Test func aBrokenFileIsAnEmptyQueue() throws {
        let file = temporaryFile()
        try Data("not json".utf8).write(to: file)
        #expect(TelemetryQueue(file: file).isEmpty)
    }

    @Test func currentIdentityNamesAPlatform() {
        let identity = TelemetryIdentity.current
        #expect(!identity.appVersion.isEmpty && !identity.build.isEmpty)
        #expect(identity.platform.hasPrefix("macOS ") || identity.platform.hasPrefix("iOS "))
    }
}

@MainActor
struct TelemetryFlowTests {
    private func api(_ daemon: TestDaemon) -> FardeskAPI {
        FardeskAPI(baseURL: daemon.url, token: TestDaemon.token)
    }

    @Test func aFailedActionIsQueuedWithMachineAndActionAndFlushedToTheDaemon() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, _) = try await readyModel(daemon, sandbox)
                let unknown = SessionRef(machineID: try #require(model.machines.endpoints.first).id, sessionID: "nope")
                await model.openSession(unknown)
                let queued = try #require(model.configuration.telemetry.pending.first)
                #expect(queued.area == "load activity" && queued.machine == "box")
                #expect(queued.appVersion == "9.9" && queued.build == "99" && queued.platform == "test")
                #expect(queued.code == "not_found" || queued.code == "invalid_request")

                await model.flushTelemetry()
                #expect(model.configuration.telemetry.isEmpty)
                let stored = try await api(daemon).telemetry().reports
                #expect(stored.contains { $0.id == queued.id })
                model.stop()
            }
        }
    }

    @Test func cancellationsAreNeverReported() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            let dead = MachineEndpoint(name: "dead", url: URL(string: "http://127.0.0.1:9")!)
            model.handleFailure(CancellationError(), machineID: dead.id, action: "x", origin: .user)
            model.handleFailure(URLError(.cancelled), machineID: dead.id, action: "x", origin: .user)
            #expect(model.configuration.telemetry.isEmpty)
        }
    }

    @Test func aReportReachesTheLiveMachineEvenWhenAnotherIsDeadAndStaysQueuedWhenNoneAnswers() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let dead = try pairDeadMachine(in: sandbox)
                let (model, _) = try await readyModel(daemon, sandbox)
                model.enqueueReport(message: "from the phone", area: "reply", code: nil, machineID: dead.id)
                await model.flushTelemetry()
                #expect(!model.configuration.telemetry.pending.contains { $0.message == "from the phone" })
                #expect(try await api(daemon).telemetry().reports.contains { $0.message == "from the phone" && $0.machine == "dead" })
                model.stop()
            }
        }
        try await StoreSandbox.with { sandbox in
            let dead = try pairDeadMachine(in: sandbox)
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            model.enqueueReport(message: "nobody home", area: "reply", code: nil, machineID: nil)
            await model.flushTelemetry()
            #expect(model.configuration.telemetry.pending.map(\.message).contains("nobody home"))
            model.stop()
        }
    }

    @Test func theLoopFlushesQueuedReportsOnItsOwn() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let endpoint = try sandbox.pair(daemon)
                let model = AppModel(configuration: sandbox.configuration(telemetryInterval: 0.1))
                await model.start()
                model.enqueueReport(message: "every tick", area: "loop", code: nil, machineID: endpoint.id)
                let delivered = try await waitUntil { await MainActor.run { model.configuration.telemetry.isEmpty } }
                #expect(delivered)
                model.stop()
            }
        }
    }
}

@MainActor
struct SendWithAttachmentsTests {
    @Test func attachmentsOnlyGetsAShortText() {
        let png = OutgoingAttachment(source: .data(Data([1])), mediaType: "image/png", filename: "a.png")
        #expect(OutgoingMessage(text: "  ", attachments: [png]).textToSend == "See attached.")
        #expect(OutgoingMessage(text: "look", attachments: [png]).textToSend == "look")
        #expect(OutgoingMessage(text: "", attachments: []).textToSend == "")
    }

    @Test func picturesAndAudioAreUploadedBeforeTheMessageAndAnUnsendableSessionAlertsWithMachineAndAction() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let audio = sandbox.root.appending(path: "voice.m4a")
                try Data([0, 1, 2, 3]).write(to: audio)
                let message = OutgoingMessage(text: "", attachments: [
                    OutgoingAttachment(source: .data(Data([9, 9, 9])), mediaType: "image/png", filename: "shot.png"),
                    OutgoingAttachment(source: .file(audio), mediaType: "audio/m4a", filename: "voice.m4a"),
                ])
                let ref = SessionRef(machineID: endpoint.id, sessionID: SeedSession.endedSessionID)
                #expect(await !model.send(message, to: ref))
                let alert = try #require(model.notices[.session(ref)]?.text)
                #expect(alert.hasPrefix("Could not send the message with its attachments on box: "))
                let index = try String(contentsOf: daemon.stateDirectory.appending(path: "attachments-index.json"), encoding: .utf8)
                #expect(index.contains("shot.png") && index.contains("voice.m4a"))
                model.stop()
            }
        }
    }

    @Test func anUnreadableAudioFileIsAFailureLineNotACrash() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let missing = sandbox.root.appending(path: "missing.m4a")
                let message = OutgoingMessage(text: "x", attachments: [
                    OutgoingAttachment(source: .file(missing), mediaType: "audio/m4a", filename: "missing.m4a")
                ])
                let ref = SessionRef(machineID: endpoint.id, sessionID: SeedSession.endedSessionID)
                #expect(await !model.send(message, to: ref))
                #expect(model.notices[.session(ref)]?.text.hasPrefix("Could not send the message with its attachments on box: ") == true)
                model.stop()
            }
        }
    }

    @Test func endingASessionCanAskToCloseItsTab() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let ref = SessionRef(machineID: endpoint.id, sessionID: SeedSession.hookSessionID)
                #expect(await model.kill(ref, closeTab: true))
                #expect(model.lastError == nil)
                model.stop()
            }
        }
    }
}
