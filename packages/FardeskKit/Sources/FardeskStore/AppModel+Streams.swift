import FardeskClient
import FardeskModels
import Foundation

extension AppModel {
    /// One reconnecting stream per machine that has a token; machines without one show as offline.
    func connectAll() {
        stop()
        machines.endpoints.forEach { openStream(for: $0) }
        if isHubMode { startHubPolling() }
    }

    /// (Re)starts the live stream of one machine; a machine without a token shows as logged out.
    func openStream(for endpoint: MachineEndpoint) {
        closeStream(of: endpoint.id)
        let api: FardeskAPI
        do {
            api = try access.api(for: endpoint)
        } catch {
            return markOffline(endpoint.id, after: error)
        }
        let stream = ReconnectingStream(api: api, policy: configuration.backoff)
        let token = UUID()
        streamTokens[endpoint.id] = token
        streams[endpoint.id] = Task { await consume(stream, of: endpoint, token: token) }
    }

    func closeStream(of machineID: UUID) {
        streams[machineID]?.cancel()
        streams[machineID] = nil
        streamTokens[machineID] = nil
    }

    private func consume(_ stream: ReconnectingStream, of endpoint: MachineEndpoint, token: UUID) async {
        do {
            for try await update in stream.updates() {
                handle(update, from: endpoint.id)
            }
        } catch {
            handleFailure(error, machineID: endpoint.id, action: "keep the live connection", origin: .background)
            if !error.isTokenRevoked, !error.isDeviceMoved { markOffline(endpoint.id, after: error) }
        }
        if streamTokens[endpoint.id] == token { streams[endpoint.id] = nil }
    }

    private func handle(_ update: StreamUpdate, from machineID: UUID) {
        switch update {
        case .connecting:
            // A retry of a machine already known to be Offline stays Offline; only the first
            // attempt shows "Connecting".
            guard let connection = try? state.machine(id: machineID).connection else { break }
            if case .offline = connection { break }
            if connection != .connecting { try? state.markConnecting(machineID: machineID) }
        case .connected:
            recordEvent("stream", "connected", machineID: machineID)
            Task {
                await flushOutbox(on: machineID)
                if machineID == hubMachineID { await refreshCoordinator() }
                await refreshPause(of: machineID)
                await flushTelemetry()
            }
        case .disconnected:
            recordEvent("stream", "disconnected", machineID: machineID)
            if !isHubMode { markOffline(machineID) }
        case .event(let event): apply(event, from: machineID)
        }
    }
}
