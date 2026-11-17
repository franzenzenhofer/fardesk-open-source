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
    nonisolated static let bootstrapInfoKey = "FardeskBootstrapMachines"
    nonisolated static let hubInfoKey = "FardeskHub"

    let model: AppModel
    let coordinator = SessionCoordinator()
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
        let support = URL.applicationSupportDirectory.appending(path: "Fardesk", directoryHint: .isDirectory)
        let bootstrap = Bundle.main.object(forInfoDictionaryKey: bootstrapInfoKey) as? String ?? ""
        var forcesCold = false
        #if DEBUG
        forcesCold = UserDefaults.standard.bool(forKey: "FardeskForceCold")
        #endif
        var hubTransport: URL?
        #if DEBUG
        // UI tests: the hub is "down" (requests go nowhere) while the app stays logged in as before.
        if UserDefaults.standard.bool(forKey: "FardeskHubDown") { hubTransport = URL(string: "http://127.0.0.1:9") }
        #endif
        var hubText = Bundle.main.object(forInfoDictionaryKey: hubInfoKey) as? String ?? ""
        #if DEBUG
        // UI tests point the app at a hub that is not there (launch argument -FardeskHubOverride <url>).
        if let override = UserDefaults.standard.string(forKey: "FardeskHubOverride") { hubText = override }
        #endif
        return AppModelConfiguration(
            machinesFile: MachineListFile(url: support.appending(path: "machines.json")),
            tokens: .keychain(service: keychainService),
            cache: OfflineCache(directory: support.appending(path: "cache", directoryHint: .isDirectory)),
            deviceName: deviceName,
            seedMachines: BootstrapMachines.parse(bootstrap),
            telemetryFile: support.appending(path: "telemetry-queue.json"),
            hub: HubSetting.parse(hubText),
            treatsEverySessionAsCold: forcesCold,
            hubTransport: hubTransport,
            machineOrder: AppIdentity.machineOrder
        )
    }

    private static var deviceName: String {
        #if os(iOS)
        UIDevice.current.name
        #else
        Host.current().localizedName ?? "Mac"
        #endif
    }
}
