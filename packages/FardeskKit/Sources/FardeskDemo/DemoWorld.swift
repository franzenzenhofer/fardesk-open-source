import FardeskClient
import FardeskModels
import Foundation
import Synchronization

/// One pretend machine of the demo: where the app lists it. Nothing ever connects to the address.
public struct DemoMachine: Sendable, Hashable, Identifiable {
    public let key: String
    public let id: UUID
    public let name: String
    /// A name that cannot exist (RFC 6761 `.invalid`), so even a bug cannot reach a real host.
    public let url: URL
}

/// A change the demo made that the app has to learn about, as a machine's live stream would tell it.
public struct DemoEvent: Sendable {
    public let machineID: UUID
    public let event: StreamEvent
}

struct DemoState {
    var sessions: [String: DemoFixture.SessionRecord]
    var pausedUntil: Date?
    var counter = 0
}

/// Three pretend machines with their sessions, all in memory: the app's demo mode. It answers exactly what the real client's
/// `FardeskService` asks, changes only itself, and never touches the network, the disk or a keychain.
public final class DemoWorld: Sendable {
    public static let defaultReplyDelay = Duration.milliseconds(1200)

    public let machines: [DemoMachine]
    /// What happened since the app last looked (one consumer: the app model).
    public let events: AsyncStream<DemoEvent>
    let continuation: AsyncStream<DemoEvent>.Continuation
    let state: Mutex<DemoState>
    let fixture: DemoFixture
    let replyDelay: Duration
    let clock: @Sendable () -> Date

    public init(
        replyDelay: Duration = DemoWorld.defaultReplyDelay, clock: @escaping @Sendable () -> Date = { Date() }
    ) throws {
        let fixture = try DemoFixture.load(now: clock())
        self.fixture = fixture
        self.replyDelay = replyDelay
        self.clock = clock
        machines = try fixture.machines.enumerated().map { index, record in
            guard let id = UUID(uuidString: String(format: "DE300000-0000-4000-8000-%012d", index + 1)),
                  let url = URL(string: "http://\(record.machine.hostname)") else {
                throw DemoError.fixtureInvalid("machine \(record.key) has no address")
            }
            return DemoMachine(key: record.key, id: id, name: record.machine.name, url: url)
        }
        state = Mutex(DemoState(sessions: Dictionary(uniqueKeysWithValues: fixture.sessions.map { ($0.summary.id, $0) })))
        (events, continuation) = AsyncStream.makeStream(of: DemoEvent.self)
    }

    deinit { continuation.finish() }

    /// The service the app talks to for one machine, in place of the HTTP client.
    public func service(for machineID: UUID) throws -> any FardeskService {
        guard let machine = machines.first(where: { $0.id == machineID }) else {
            throw DemoError.fixtureInvalid("unknown demo machine \(machineID)")
        }
        return DemoMachineService(world: self, machineKey: machine.key)
    }

    /// What a machine says when the stream opens: itself and all its sessions.
    public func hello(for machineID: UUID) throws -> StreamEvent {
        guard let machine = machines.first(where: { $0.id == machineID }) else {
            throw DemoError.fixtureInvalid("unknown demo machine \(machineID)")
        }
        return .hello(machine: try machineInfo(machine.key), sessions: sessions(of: machine.key))
    }

    func machineInfo(_ key: String) throws -> Machine {
        guard let record = fixture.machines.first(where: { $0.key == key }) else {
            throw DemoError.fixtureInvalid("unknown demo machine \(key)")
        }
        return record.machine
    }

    func folders(of key: String) -> [RecentFolder] {
        fixture.machines.first { $0.key == key }?.folders ?? []
    }

    func sessions(of key: String) -> [SessionSummary] {
        state.withLock { $0.sessions.values.filter { $0.machine == key }.map(\.summary) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    func record(_ sessionID: String, on key: String) throws -> DemoFixture.SessionRecord {
        guard let found = state.withLock({ $0.sessions[sessionID] }), found.machine == key else {
            throw DemoWorld.notFound("session \(sessionID)")
        }
        return found
    }

    static func notFound(_ what: String) -> FardeskAPIError {
        .server(status: 404, response: ErrorResponse(error: ErrorBody(code: .notFound, message: "Not found in the demo: \(what).")))
    }

    static func conflict(_ message: String) -> FardeskAPIError {
        .server(status: 409, response: ErrorResponse(error: ErrorBody(code: .conflict, message: message)))
    }

    func emit(_ events: [StreamEvent], machineKey: String) {
        guard let machine = machines.first(where: { $0.key == machineKey }) else { return }
        for event in events { continuation.yield(DemoEvent(machineID: machine.id, event: event)) }
    }
}
