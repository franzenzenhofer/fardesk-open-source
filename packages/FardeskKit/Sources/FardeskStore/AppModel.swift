import FardeskClient
import FardeskModels
import Foundation
import Observation

/// Everything the app needs injected: where things are stored and how this device calls itself.
public struct AppModelConfiguration: Sendable {
    public let machinesFile: MachineListFile
    public let tokens: TokenStore
    public let cache: OfflineCache
    public let deviceName: String
    /// The machines to start with when the machine file is still empty (from a build setting).
    public let seedMachines: [Peer]
    public let requestTimeout: TimeInterval
    public let backoff: BackoffPolicy
    /// Whether this device is on Tailscale; read only when no machine answers.
    public let tailscaleIsOn: @Sendable () -> Bool
    /// Errors waiting to be reported to the machines.
    public let telemetry: TelemetryQueue
    public let telemetryIdentity: TelemetryIdentity
    /// The hub to go through, or nil to talk to every machine itself.
    public let hub: URL?
    public let hubPollInterval: TimeInterval
    /// A hub that does not answer within this is reported unreachable (the normal timeout is 15 s).
    public let hubPollTimeout: TimeInterval
    /// Test builds treat every session as cold (UI tests cannot wait for a real cache to expire).
    public let treatsEverySessionAsCold: Bool
    /// How long cache writes wait for more changes.
    public let cacheWriteDelay: TimeInterval
    /// Requests go to this address while the app stays logged in to `hub` (DEBUG: simulates a hub that is down).
    public let hubTransport: URL?
    public let telemetryInterval: TimeInterval
    /// Machine names listed first in the session list (the owner's order; empty = alphabetical).
    public let machineOrder: [String]

    public init(
        machinesFile: MachineListFile,
        tokens: TokenStore,
        cache: OfflineCache,
        deviceName: String,
        seedMachines: [Peer] = [],
        requestTimeout: TimeInterval = FardeskAPI.defaultTimeout,
        backoff: BackoffPolicy = .standard,
        tailscaleIsOn: @escaping @Sendable () -> Bool = TailscaleInterface.isUp,
        telemetryFile: URL? = nil,
        telemetryIdentity: TelemetryIdentity = .current,
        telemetryInterval: TimeInterval = 60,
        hub: URL? = nil,
        hubPollInterval: TimeInterval = 5,
        hubPollTimeout: TimeInterval = 4,
        treatsEverySessionAsCold: Bool = false,
        hubTransport: URL? = nil,
        cacheWriteDelay: TimeInterval = CacheWriter.delay,
        machineOrder: [String] = []
    ) {
        self.cacheWriteDelay = cacheWriteDelay
        self.machineOrder = machineOrder
        self.hubTransport = hubTransport
        self.treatsEverySessionAsCold = treatsEverySessionAsCold
        self.hubPollTimeout = hubPollTimeout
        self.hub = hub
        self.hubPollInterval = hubPollInterval
        telemetry = TelemetryQueue(file: telemetryFile)
        self.telemetryIdentity = telemetryIdentity
        self.telemetryInterval = telemetryInterval
        self.tailscaleIsOn = tailscaleIsOn
        self.machinesFile = machinesFile
        self.tokens = tokens
        self.cache = cache
        self.deviceName = deviceName
        self.seedMachines = seedMachines
        self.requestTimeout = requestTimeout
        self.backoff = backoff
    }
}

/// A session on one machine.
public struct SessionRef: Hashable, Sendable {
    public let machineID: UUID
    public let sessionID: String

    public init(machineID: UUID, sessionID: String) {
        self.machineID = machineID
        self.sessionID = sessionID
    }
}

/// The app's single observable model: login phase, machines, sessions, feeds and every action.
/// SwiftUI reads it; the pure reducer (`AppState`) and the clients do the work.
@MainActor
@Observable
public final class AppModel {
    public enum Phase: Equatable, Sendable {
        /// The app just started: the stored login is being checked. Never the login screen yet.
        case launching
        case loggedOut
        case loggingIn
        case ready
    }

    public internal(set) var state = AppState()
    /// Every session's feed, outside `state`: an activity row wakes only the screen that shows that session.
    public let feeds = FeedStore()
    /// The latest end of any machine's notification pause (nil = none); set only when it changes, so the bell
    /// does not read the whole state.
    public internal(set) var pausedUntil: Date?
    /// Called when a session's feed changed through a stream row (the pinned Live Activity follows one feed).
    @ObservationIgnored public var onFeedChange: ((SessionRef, SessionFeed) -> Void)?
    public internal(set) var phase = Phase.launching
    public internal(set) var loginError: String?
    /// The one alert on screen (nil = none). Set only through `raise`.
    public internal(set) var lastError: String?
    public internal(set) var machines = MachineList()
    /// How the hub answers (nil without a hub): drives the line at the top of the Machines screen.
    public internal(set) var hubStatus: HubStatus?
    /// Messages on their way: shown in the feed the moment they are tapped.
    public internal(set) var outbox = Outbox()
    /// What is happening for a session (starting, opening, resuming...), step by step.
    public internal(set) var stepLogs: [SessionRef: StepLog] = [:]
    /// A session that was being started and now exists (the screen switches to it).
    public internal(set) var startedSessions: [SessionRef: SessionRef] = [:]
    /// The latest action result per place: inside its session's feed, or at the top of the list.
    public internal(set) var notices: [NoticeScope: ActionFeedback] = [:]
    /// Counts failures the user should feel (one error haptic each).
    public internal(set) var failureSignal = 0
    /// Counts the user's sends: the feed scrolls to the bottom on every change.
    public internal(set) var sendSignal = 0
    /// Sessions that need the user, set only when it really changes (the badge, the widget).
    public internal(set) var needsYou: [NeedsYouItem] = []
    /// The online machines with what the New Session sheet needs of them, set only when it changes (the sheet does not
    /// read the whole state, so a stream of activity rows does not rebuild it).
    public internal(set) var onlineMachines: [OnlineMachine] = []
    /// The coordinator's session on the hub machine; nil until it exists. Cached on disk.
    public internal(set) var coordinatorSessionID: String?
    /// Called after every state change with the new state (cheap: a value copy); the app hands it to the ExtensionWriter.
    @ObservationIgnored public var onStateChange: ((AppState) -> Void)?
    @ObservationIgnored var startInFlight = false
    /// Sessions waiting for the user to choose how to continue (the cold card): the held message, if any.
    public internal(set) var coldHolds: [SessionRef: ColdHold] = [:]
    @ObservationIgnored var noticeClears: [NoticeScope: Task<Void, Never>] = [:]
    @ObservationIgnored var knownHubName: String?
    @ObservationIgnored var alertGate = AlertGate()

    /// Why nothing answers, when nothing does.
    public internal(set) var connectivityBanner: ConnectivityBanner?
    @ObservationIgnored var bannerConnections: [ConnectionState] = []

    /// Shows an alert unless one is already showing or the same text was just shown.
    func raise(_ message: String) {
        guard alertGate.admit(message, showing: lastError, now: Date()) else { return }
        lastError = message
    }

    func machineName(_ machineID: UUID) -> String {
        machines.endpoints.first { $0.id == machineID }?.name ?? "Unknown machine"
    }

    let configuration: AppModelConfiguration
    let access: MachineAccess
    let auth: AuthSession
    let localWipe: LocalWipe
    /// Every cache write goes through here: off the main thread, coalesced, only when something changed.
    public let cacheWriter: CacheWriter
    @ObservationIgnored var streams: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored var hubPoll: Task<Void, Never>?
    @ObservationIgnored var telemetryLoop: Task<Void, Never>?
    @ObservationIgnored var pushRegistrationKey: String?
    @ObservationIgnored var streamTokens: [UUID: UUID] = [:]
    @ObservationIgnored var dirtyFeeds: Set<SessionRef> = []
    @ObservationIgnored var feedFlush: Task<Void, Never>?
    @ObservationIgnored var flushingTelemetry = false
    /// A flush was asked for while another ran: it runs once more right after, so no report waits for the next interval.
    @ObservationIgnored var telemetryFlushQueued = false

    public init(configuration: AppModelConfiguration) {
        self.configuration = configuration
        state = AppState(machineOrder: configuration.machineOrder)
        access = MachineAccess(tokens: configuration.tokens, timeout: configuration.requestTimeout, hub: configuration.hub, transport: configuration.hubTransport)
        auth = AuthSession(access: access)
        localWipe = LocalWipe(tokens: configuration.tokens, cache: configuration.cache)
        let telemetry = configuration.telemetry
        let identity = configuration.telemetryIdentity
        cacheWriter = CacheWriter(
            cache: configuration.cache, machinesFile: configuration.machinesFile, delay: configuration.cacheWriteDelay
        ) { what, error in
            telemetry.enqueue(TelemetryReport(
                at: Date(), message: error.localizedDescription, area: what,
                appVersion: identity.appVersion, build: identity.build, platform: identity.platform
            ))
        }
    }

    public var isLoggedIn: Bool { phase == .ready }

    /// Loads the machine list and tokens; when logged in, shows the cached sessions at once and
    /// connects a live stream per machine.
    public func start() async {
        guard !startInFlight else { return }
        startInFlight = true
        defer { startInFlight = false }
        Breadcrumbs.mark("start")
        defer { Breadcrumbs.mark("idle") }
        do {
            // Before the switch to hub mode empties the old list (it holds the older build's logins).
            try adoptDirectTokenForHub(from: try configuration.machinesFile.load())
            machines = try loadMachines()
            hubStatus = isHubMode ? .connecting : nil
            state.sync(endpoints: machines.endpoints)
            guard try auth.isLoggedIn() else { return phase = .loggedOut }
            coordinatorSessionID = configuration.cache.loadCoordinatorID()
            await restoreCache()
            phase = .ready
            recordEvent("app", "start (launch or foreground)")
            connectAll()
            startTelemetryLoop()
        } catch {
            phase = .loggedOut
            raise("Fardesk: could not read the saved machines: \(ErrorText.detail(error))", area: "start", error: error)
        }
    }

    /// Stops every live stream (the app goes to the background or the model goes away).
    public func stop() {
        streams.values.forEach { $0.cancel() }
        streams = [:]
        hubPoll?.cancel()
        hubPoll = nil
        configuration.telemetry.flushToDisk()
        // Feeds first: flushFeeds only queues them on the cache writer, and flush() then writes the queue to disk.
        flushFeeds()
        cacheWriter.flush()
        Task { await flushTelemetry() }
    }

    /// Re-reads machines and sessions over HTTP, for pull to refresh.
    public func refresh() async {
        if isHubMode { await pollHub() }
        let endpoints = machines.endpoints
        let answers = await withTaskGroup(of: (MachineEndpoint, Result<StreamEvent, any Error>).self) { group in
            for endpoint in endpoints {
                group.addTask { (endpoint, await self.overview(of: endpoint)) }
            }
            var all: [(MachineEndpoint, Result<StreamEvent, any Error>)] = []
            for await answer in group { all.append(answer) }
            return all
        }
        for (endpoint, answer) in answers {
            switch answer {
            case .success(let hello): apply(hello, from: endpoint.id)
            case .failure(let error):
                handleFailure(error, machineID: endpoint.id, action: "refresh the sessions", origin: .background)
            }
        }
    }

    // MARK: Shared with the extensions

    func apply(_ event: StreamEvent, from machineID: UUID) {
        Breadcrumbs.mark("apply event")
        defer { Breadcrumbs.mark("idle") }
        if case .activity(let sessionID, let activity) = event {
            return applyActivity(activity, sessionID: sessionID, from: machineID)
        }
        guard (try? state.machine(id: machineID))?.wouldChange(by: event) ?? true else { return }
        do {
            try state.apply(event, from: machineID)
            stateChanged()
            releaseAnswerHolds()
            if case .hello = event { persist(machineID) }
        } catch {
            raise(ErrorText.message(machine: machineName(machineID), action: "update the sessions", error: error), area: "update the sessions", error: error, machineID: machineID)
        }
    }

    func persist(_ machineID: UUID) {
        Breadcrumbs.mark("persist snapshot")
        defer { Breadcrumbs.mark("idle") }
        if let machine = try? state.machine(id: machineID) { cacheWriter.save(machine.snapshot) }
    }

    func markOffline(_ machineID: UUID, after error: (any Error)? = nil) {
        do {
            let before = try state.machine(id: machineID)
            var after = before
            if let error { after.markFailed(by: error, now: Date()) } else { after.markOffline(now: Date()) }
            guard after != before else { return }
            if let error {
                try state.markFailed(machineID: machineID, by: error, now: Date())
            } else {
                try state.markOffline(machineID: machineID, now: Date())
            }
            stateChanged()
            persist(machineID)
        } catch {
            raise(ErrorText.message(machine: machineName(machineID), action: "update the machine state", error: error), area: "update the machine state", error: error, machineID: machineID)
        }
    }

    /// A revoked token wipes everything. A cancelled call is silent. A machine that cannot be
    /// reached or refuses the token is marked Offline / Logged out, and alerts only when the user
    /// started the call on a machine that was reachable until now. Any other failure alerts only
    /// for a user-started call. Every alert names the machine and the action.
    func handleFailure(_ error: any Error, machineID: UUID, action: String, origin: CallOrigin) {
        if error.isTokenRevoked { return wipeEverything(reason: "This device was signed out. Log in again.") }
        if error.isCancellation { return }
        if let problem = error.machineOfflineMessage { return markMachineOffline(machineID, problem: problem) }
        report(error, area: action, machineID: machineID)
        let wasReachable = (try? state.machine(id: machineID))?.isOnline == true
        let message = ErrorText.message(machine: machineName(machineID), action: action, error: error)
        if case .transport = error as? FardeskAPIError {
            markOffline(machineID)
            if origin == .user, wasReachable { raise(message) }
            return
        }
        if error.meansLoggedOut { return markOffline(machineID, after: error) }
        if origin == .user { raise(message) }
    }

    // MARK: Private

    private func overview(of endpoint: MachineEndpoint) async -> Result<StreamEvent, any Error> {
        do {
            let api = try access.api(for: endpoint)
            async let machine = api.machine()
            async let sessions = api.sessions()
            return try await .success(.hello(machine: machine, sessions: sessions))
        } catch {
            return .failure(error)
        }
    }

    private func loadMachines() throws -> MachineList {
        var stored = try configuration.machinesFile.load()
        let previous = stored.endpoints
        stored.setHub(configuration.hub)
        if let hub = configuration.hub {
            if stored.endpoints.isEmpty, !previous.isEmpty { try migrate(previous, into: &stored, hub: hub) }
            return stored
        }
        guard stored.endpoints.isEmpty, !configuration.seedMachines.isEmpty else { return stored }
        let seeded = MachineList(
            endpoints: configuration.seedMachines.map { MachineEndpoint(name: $0.name, url: $0.url) }
        )
        try configuration.machinesFile.save(seeded)
        return seeded
    }

    /// Reads the cached machine snapshots on a background thread (the launch screen shows meanwhile) and puts them in place.
    private func restoreCache() async {
        let cache = configuration.cache
        let ids = machines.endpoints.map(\.id)
        let snapshots = await Task.detached { ids.compactMap { cache.load(machineID: $0) } }.value
        Breadcrumbs.mark("restore cache")
        defer { Breadcrumbs.mark("idle") }
        for snapshot in snapshots { try? state.restore(snapshot) }
        stateChanged()
    }
}
