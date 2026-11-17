import FardeskModels
import Foundation

/// Telemetry about what happens, not only what fails: events go through the same queue as errors
/// and reach the hub (or every machine without one) with the next flush.
extension AppModel {
    /// Queues one event. `duration` is how long the thing took, when that is the point of it.
    public func recordEvent(
        _ area: String,
        _ message: String,
        machineID: UUID? = nil,
        sessionID: String? = nil,
        since started: Date? = nil
    ) {
        let identity = configuration.telemetryIdentity
        configuration.telemetry.enqueue(
            TelemetryReport(
                at: Date(),
                message: message,
                area: area,
                appVersion: identity.appVersion,
                build: identity.build,
                platform: identity.platform,
                machine: machineID.map(machineName),
                sessionId: sessionID,
                kind: .event,
                durationMs: started.map { max(0, Int((Date().timeIntervalSince($0) * 1000).rounded())) }
            )
        )
    }
}
