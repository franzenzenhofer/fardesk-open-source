import FardeskClient
import FardeskModels
import Foundation

/// One machine's registered devices, or why they could not be read.
public struct MachineDevices: Sendable, Equatable {
    public static let unreachableProblem = "Unreachable"
    public static let defaultTimeout: TimeInterval = 4

    public let machineID: UUID
    public let machineName: String
    public let devices: [AuthDevice]
    public let problem: String?
}

extension AppModel {
    /// The devices of every machine, read concurrently with a short timeout. Each machine is
    /// delivered the moment it answers; a machine that does not answer arrives as "Unreachable".
    public func deviceUpdates(timeout: TimeInterval = MachineDevices.defaultTimeout) -> AsyncStream<MachineDevices> {
        let access = MachineAccess(tokens: configuration.tokens, timeout: timeout, hub: access.hub, cache: access.tokenCache, transport: access.transport)
        let endpoints = demo == nil ? machines.endpoints : []
        return AsyncStream { continuation in
            let reading = Task {
                await withTaskGroup(of: MachineDevices.self) { group in
                    for endpoint in endpoints {
                        group.addTask { await Self.readDevices(of: endpoint, access: access) }
                    }
                    for await machine in group { continuation.yield(machine) }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in reading.cancel() }
        }
    }

    /// The same as `deviceUpdates`, collected in machine order.
    public func devices(timeout: TimeInterval = MachineDevices.defaultTimeout) async -> [MachineDevices] {
        var answers: [UUID: MachineDevices] = [:]
        for await machine in deviceUpdates(timeout: timeout) { answers[machine.machineID] = machine }
        return machines.endpoints.compactMap { answers[$0.id] }
    }

    private nonisolated static func readDevices(of endpoint: MachineEndpoint, access: MachineAccess) async -> MachineDevices {
        func answer(_ devices: [AuthDevice], _ problem: String?) -> MachineDevices {
            MachineDevices(machineID: endpoint.id, machineName: endpoint.name, devices: devices, problem: problem)
        }
        do {
            return answer(try await access.api(for: endpoint).authDevices().devices, nil)
        } catch FardeskAPIError.transport {
            return answer([], MachineDevices.unreachableProblem)
        } catch {
            return answer([], ErrorText.detail(error))
        }
    }
}
