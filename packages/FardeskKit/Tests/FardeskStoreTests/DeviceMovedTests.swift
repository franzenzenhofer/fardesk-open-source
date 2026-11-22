import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// The token is bound to the Tailscale node the device paired from (#108): a daemon that sees it from another node
/// answers `device_moved`, and the app returns to the pairing screen with the daemon's words.
@MainActor
struct DeviceMovedTests {
    private func refused(_ code: String, _ message: String, status: Int = 401) throws -> FardeskAPIError {
        let body = Data(#"{"error":{"code":"\#(code)","message":"\#(message)"}}"#.utf8)
        return .server(status: status, response: try FardeskJSON.makeDecoder().decode(ErrorResponse.self, from: body))
    }

    private let movedMessage = "This device was paired from another Tailscale device. Pair again."

    @Test func aMovedDeviceWipesAndShowsThePairingScreenWithTheMessage() async throws {
        let error = try refused("device_moved", movedMessage)
        #expect(error.isDeviceMoved)
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            model.handleFailure(error, machineID: UUID(), action: "load sessions", origin: .background)
            #expect(model.phase == .loggedOut)
            #expect(model.loginError == movedMessage)
            #expect(model.machines.endpoints.isEmpty)
        }
    }

    @Test func aSilentTailscaleOnTheComputerIsAPlainNotice() throws {
        let error = try refused("tailscale_unavailable", "Tailscale on this computer is not running", status: 503)
        #expect(error.localizedDescription == "Tailscale on that computer is not running")
        #expect(!error.isDeviceMoved && !error.isTokenRevoked)
    }
}
