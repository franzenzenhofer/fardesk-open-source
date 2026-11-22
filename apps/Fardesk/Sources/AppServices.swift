import FardeskModels
import FardeskStore
import Foundation
#if os(iOS)
import UIKit
#endif

/// Process-wide objects the SwiftUI app and the push delegate share.
@MainActor
final class AppServices {
    static let shared = AppServices()

    nonisolated static let keychainService = AppIdentity.bundleID
    nonisolated static let apnsTokenKey = "apnsToken"
    nonisolated static let requireFaceIDKey = "requireFaceID"

    let model: AppModel
    let coordinator = SessionCoordinator()
    /// Demo mode (pretend machines in a model of their own); idle until the user asks to see it.
    let demo = DemoMode()
    /// The one reader of replies for the whole app: every screen with a composer needs it in its environment.
    let voice = VoiceReader()
    let extensionWriter: ExtensionWriter
    #if os(iOS)
    let liveActivity = LiveActivityController()
    #endif

    private init() {
        UserDefaults.standard.register(defaults: [Self.requireFaceIDKey: false])
        let model = AppModel(configuration: Self.configuration())
        self.model = model
        #if os(iOS)
        let writer = ExtensionSync.makeWriter(liveActivity: liveActivity)
        let pinned = liveActivity.pinned
        liveActivity.onPinnedChange = { ref in Task { await writer.setPinned(ref) } }
        Task { await writer.setPinned(pinned) }
        #else
        let writer = ExtensionSync.makeWriter(liveActivity: NoLiveActivity())
        #endif
        extensionWriter = writer
        ExtensionSync.install(model: model, writer: writer)
        Self.startWatchdog(reporting: model)
        Task { await model.start() }
    }

    private static func startWatchdog(reporting model: AppModel) {
        let log = HangLog(url: URL.applicationSupportDirectory.appending(path: "Fardesk/hangs.jsonl"))
        for hang in log.takeAll() {
            model.recordEvent("hang", "main thread blocked at \(hang.breadcrumb) (\(hang.at.formatted(.iso8601)))", since: Date(timeIntervalSinceNow: -hang.seconds))
        }
        var note: String?
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "FardeskUITest") { note = "UI test run: XCUITest element queries run on the main thread" }
        #endif
        Watchdog(log: log, note: note).start()
        #if DEBUG
        let blocked = UserDefaults.standard.double(forKey: "FardeskBlockMain")
        if blocked > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                Breadcrumbs.mark("debug block")
                Thread.sleep(forTimeInterval: blocked)
                Breadcrumbs.mark("idle")
            }
        }
        #endif
    }

    var apnsToken: String? { UserDefaults.standard.string(forKey: Self.apnsTokenKey) }

    var apnsEnvironment: APNsEnvironment {
        #if DEBUG
        .sandbox
        #else
        .production
        #endif
    }

    /// Registers the stored push token with every machine, with the notification types the user chose.
    func registerStoredToken() async {
        guard let token = apnsToken else { return }
        let types = NotificationPreferences().enabled
        await model.registerPush(apnsToken: token, environment: apnsEnvironment, notifications: types)
    }

    private static func configuration() -> AppModelConfiguration {
        var support = URL.applicationSupportDirectory.appending(path: "Fardesk", directoryHint: .isDirectory)
        var tokenService = keychainService
        #if DEBUG
        // UI tests: a clean install on a fresh directory and an empty keychain service, so the paired state the
        // other tests rely on stays untouched (launch argument -FardeskCleanStart YES).
        if UserDefaults.standard.bool(forKey: "FardeskCleanStart") {
            support = FileManager.default.temporaryDirectory.appending(path: "fardesk-clean-\(UUID().uuidString)", directoryHint: .isDirectory)
            tokenService += ".cleanstart"
        }
        #endif
        var hubTransport: URL?
        #if DEBUG
        // UI tests: the hub is "down" (requests go nowhere) while the app stays logged in as before.
        if UserDefaults.standard.bool(forKey: "FardeskHubDown") { hubTransport = URL(string: "http://127.0.0.1:9") }
        #endif
        var tailscaleIsOn: @Sendable () -> Bool = TailscaleInterface.isUp
        #if DEBUG
        // UI tests: the simulator shares the host network, so Tailscale is declared by launch argument -FardeskTailscale on|off.
        switch UserDefaults.standard.string(forKey: "FardeskTailscale") {
        case "on": tailscaleIsOn = { true }
        case "off": tailscaleIsOn = { false }
        default: break
        }
        #endif
        var hub: HubLink?
        #if DEBUG
        // UI tests point the app at a hub that is not there (launch argument -FardeskHubOverride "<http url>").
        if let override = UserDefaults.standard.string(forKey: "FardeskHubOverride") { hub = hubLink(from: override) }
        #endif
        return AppModelConfiguration(
            machinesFile: MachineListFile(url: support.appending(path: "machines.json")),
            tokens: .keychain(service: tokenService),
            cache: OfflineCache(directory: support.appending(path: "cache", directoryHint: .isDirectory)),
            deviceName: deviceName,
            tailscaleIsOn: tailscaleIsOn,
            telemetryFile: support.appending(path: "telemetry-queue.json"),
            hub: hub,
            hubTransport: hubTransport,
            machineOrderFile: MachineOrderFile(url: support.appending(path: "machine-order.json"))
        )
    }

    #if DEBUG
    private static func hubLink(from text: String) -> HubLink? {
        guard let url = URL(string: text), MachineAddress.isAllowed(url) else { return nil }
        return HubLink(url: url)
    }
    #endif

    private static var deviceName: String {
        #if os(iOS)
        UIDevice.current.name
        #else
        Host.current().localizedName ?? "Mac"
        #endif
    }
}
