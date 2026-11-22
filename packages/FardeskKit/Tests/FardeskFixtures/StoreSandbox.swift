import FardeskClient
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation

/// A throw-away place for everything the store writes: machine list, offline cache, token file,
/// and a uniquely named REAL keychain service that is emptied afterwards.
public struct StoreSandbox: Sendable {
    public let root: URL
    public let keychainService: String

    public var machinesFile: MachineListFile { MachineListFile(url: root.appending(path: "machines.json")) }
    public var machineOrderFile: MachineOrderFile { MachineOrderFile(url: root.appending(path: "machine-order.json")) }
    public var cache: OfflineCache { OfflineCache(directory: root.appending(path: "cache", directoryHint: .isDirectory)) }
    public var tokenFileURL: URL { root.appending(path: "tokens.json") }
    public var keychainTokens: TokenStore { .keychain(service: keychainService) }
    public var telemetryFile: URL { root.appending(path: "telemetry-queue.json") }
    public var fileTokens: TokenStore { .file(url: tokenFileURL) }

    public init() throws {
        let id = UUID().uuidString.lowercased()
        root = URL(filePath: "/tmp", directoryHint: .isDirectory).appending(path: "fds-\(id.prefix(8))", directoryHint: .isDirectory)
        keychainService = "com.fardesk.tests.\(id)"
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    /// Runs `body`, then deletes every keychain item the test created. The directory stays in /tmp.
    public static func with<Result: Sendable>(
        isolation: isolated (any Actor)? = #isolation,
        _ body: (StoreSandbox) async throws -> Result
    ) async throws -> Result {
        let sandbox = try StoreSandbox()
        do {
            let result = try await body(sandbox)
            try sandbox.keychainTokens.deleteAll()
            return result
        } catch {
            try? sandbox.keychainTokens.deleteAll()
            throw error
        }
    }

    /// Pairs a running test daemon the way `fardesk pair` does: the machine goes into the list and
    /// the config token becomes that machine's token. Returns the endpoint.
    @discardableResult
    public func pair(_ daemon: TestDaemon, name: String = "box", tokens: TokenStore? = nil) throws -> MachineEndpoint {
        let endpoint = MachineEndpoint(name: name, url: daemon.url)
        var list = try machinesFile.load()
        list.add(endpoint)
        try machinesFile.save(list)
        try (tokens ?? keychainTokens).save(TestDaemon.token, endpoint.id)
        return endpoint
    }

    public func configuration(
        tokens: TokenStore? = nil,
        deviceName: String = "Test Device",
        telemetryInterval: TimeInterval = 60,
        hub: HubLink? = nil,
        tailscaleIsOn: (@Sendable () -> Bool)? = nil,
        updatePollInterval: TimeInterval = 0.1,
        updateGiveUpAfter: TimeInterval = 3
    ) -> AppModelConfiguration {
        AppModelConfiguration(
            machinesFile: machinesFile,
            tokens: tokens ?? keychainTokens,
            cache: cache,
            deviceName: deviceName,
            requestTimeout: 5,
            backoff: BackoffPolicy(initial: 0.05, maximum: 0.2, jitter: 0),
            tailscaleIsOn: tailscaleIsOn ?? { true },
            telemetryFile: telemetryFile,
            telemetryIdentity: TelemetryIdentity(appVersion: "9.9", build: "99", platform: "test"),
            telemetryInterval: telemetryInterval,
            hub: hub,
            hubPollInterval: 0.2,
            cacheWriteDelay: 0.02,
            machineOrderFile: machineOrderFile,
            updatePollInterval: updatePollInterval,
            updateGiveUpAfter: updateGiveUpAfter
        )
    }
}
