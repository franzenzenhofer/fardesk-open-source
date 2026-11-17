import FardeskClient
import FardeskModels
import Foundation

extension Error {
    /// A short machine-readable code for a report: the daemon's error code, or "domain code".
    var telemetryCode: String {
        if case .server(_, let response)? = self as? FardeskAPIError { return response.error.code.rawValue }
        let ns = self as NSError
        return "\(ns.domain) \(ns.code)"
    }
}

extension AppModel {
    /// Queues one error for the machines. `area` is the action that failed ("load activity").
    func report(_ error: any Error, area: String, machineID: UUID? = nil) {
        enqueueReport(message: ErrorText.detail(error), area: area, code: error.telemetryCode, machineID: machineID)
    }

    func enqueueReport(message: String, area: String, code: String?, machineID: UUID?) {
        let identity = configuration.telemetryIdentity
        configuration.telemetry.enqueue(
            TelemetryReport(
                at: Date(),
                message: message,
                area: area,
                appVersion: identity.appVersion,
                build: identity.build,
                platform: identity.platform,
                code: code,
                machine: machineID.map(machineName)
            )
        )
    }

    /// Reports an error that did not come from a call to a machine. One that belongs to a machine is a line at
    /// the top of the session list; only an app-wide one (start, log out, wipe) is an alert.
    func raise(_ message: String, area: String, error: any Error, machineID: UUID? = nil) {
        report(error, area: area, machineID: machineID)
        guard machineID == nil else { return showNotice(ActionFeedback(text: message, state: .failed), in: .list) }
        raise(message)
    }

    /// Sends the queued reports to every machine that answers; the queue drops them as soon as one
    /// machine took them (the machines drop duplicates by id). A failure here is silent: reporting
    /// the reporting would never end.
    public func flushTelemetry() async {
        let batch = Array(configuration.telemetry.pending.prefix(TelemetryBatch.maxReports))
        guard !batch.isEmpty else { return }
        guard !flushingTelemetry else {
            telemetryFlushQueued = true
            return
        }
        let targets = access.hubEndpoint.map { [$0] } ?? machines.endpoints
        let apis = targets.compactMap { try? access.api(for: $0) }
        guard !apis.isEmpty else { return }
        flushingTelemetry = true
        let delivered = await withTaskGroup(of: Bool.self) { group in
            for api in apis {
                group.addTask { (try? await api.reportTelemetry(batch)) != nil }
            }
            var any = false
            for await taken in group where taken { any = true }
            return any
        }
        if delivered { configuration.telemetry.remove(ids: Set(batch.map(\.id))) }
        flushingTelemetry = false
        guard telemetryFlushQueued else { return }
        telemetryFlushQueued = false
        await flushTelemetry()
    }

    /// Flushes now and then every `telemetryInterval` while reports are queued.
    func startTelemetryLoop() {
        telemetryLoop?.cancel()
        let interval = configuration.telemetryInterval
        telemetryLoop = Task { [weak self] in
            await self?.flushTelemetry()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(interval))
                if Task.isCancelled { return }
                await self?.flushTelemetry()
            }
        }
    }
}
