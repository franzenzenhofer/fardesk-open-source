import FardeskModels
import Foundation
import Synchronization

/// Who is reporting: the app version and build from the bundle, and the platform.
public struct TelemetryIdentity: Sendable, Equatable {
    public let appVersion: String
    public let build: String
    public let platform: String

    public init(appVersion: String, build: String, platform: String) {
        self.appVersion = appVersion
        self.build = build
        self.platform = platform
    }

    /// Read from the main bundle; a bundle without version keys (a test runner) reports "unknown".
    public static let current: TelemetryIdentity = {
        let info = Bundle.main.infoDictionary ?? [:]
        let os = ProcessInfo.processInfo.operatingSystemVersion
        #if os(iOS)
        let name = "iOS"
        #else
        let name = "macOS"
        #endif
        return TelemetryIdentity(
            appVersion: info["CFBundleShortVersionString"] as? String ?? "unknown",
            build: info["CFBundleVersion"] as? String ?? "unknown",
            platform: "\(name) \(os.majorVersion).\(os.minorVersion)"
        )
    }()
}

/// Reports waiting to be sent: in memory and in one small JSON file, so they survive a restart.
/// The same (area, message) is not queued twice within `repeatWindow`; at most `capacity` are kept.
public final class TelemetryQueue: Sendable {
    public static let capacity = 500
    public static let repeatWindow: TimeInterval = 60

    private struct State {
        var reports: [TelemetryReport]
        var lastQueued: [String: Date] = [:]
        /// A write is scheduled and has not run yet.
        var writeScheduled = false
    }

    private let file: URL?
    private let state: Mutex<State>
    private let persistDelay: TimeInterval
    private let writer = DispatchQueue(label: "fardesk.telemetry-queue", qos: .utility)

    /// `file` nil keeps the queue in memory only (tests). Changes reach the file after `persistDelay`, off the
    /// calling thread; `flushToDisk()` writes at once (the app calls it when it goes to the background).
    public init(file: URL?, persistDelay: TimeInterval = 2) {
        self.file = file
        self.persistDelay = persistDelay
        let stored = file.flatMap { try? Data(contentsOf: $0) }
            .flatMap { try? FardeskJSON.makeDecoder().decode([TelemetryReport].self, from: $0) } ?? []
        state = Mutex(State(reports: Array(stored.suffix(Self.capacity))))
    }

    public var pending: [TelemetryReport] { state.withLock { $0.reports } }

    public var isEmpty: Bool { state.withLock { $0.reports.isEmpty } }

    /// Queues the report unless it is an error and the same area and message was queued just before (events always queue). True when queued.
    @discardableResult
    public func enqueue(_ report: TelemetryReport) -> Bool {
        let queued = state.withLock { state in
            let key = report.area + "\u{1F}" + report.message
            if report.kind != .event {
                if let last = state.lastQueued[key], report.at.timeIntervalSince(last) < Self.repeatWindow { return false }
                state.lastQueued[key] = report.at
            }
            state.reports = Array((state.reports + [report]).suffix(Self.capacity))
            return true
        }
        if queued { schedulePersist() }
        return queued
    }

    /// Drops the reports a machine has taken.
    public func remove(ids: Set<String>) {
        state.withLock { $0.reports.removeAll { ids.contains($0.id) } }
        schedulePersist()
    }

    /// Writes the queue now, on the writer queue, and returns when it is on disk.
    public func flushToDisk() {
        writer.sync { writeNow() }
    }

    private func schedulePersist() {
        guard file != nil else { return }
        let schedule = state.withLock { state -> Bool in
            guard !state.writeScheduled else { return false }
            state.writeScheduled = true
            return true
        }
        guard schedule else { return }
        writer.asyncAfter(deadline: .now() + persistDelay) { self.writeNow() }
    }

    /// A write failure is not reported (it would report itself): the queue stays in memory.
    private func writeNow() {
        let reports = state.withLock { state -> [TelemetryReport] in
            state.writeScheduled = false
            return state.reports
        }
        guard let file, let data = try? FardeskJSON.makeEncoder().encode(reports) else { return }
        try? AtomicFile.write(data, to: file)
    }
}
