import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

struct LoggedOutTests {
    private let endpoint = MachineEndpoint(name: "Mac", url: URL(string: "http://127.0.0.1:1")!)
    private let now = Date(timeIntervalSince1970: 10_000)

    private func refused(_ code: ErrorCode) throws -> FardeskAPIError {
        let body = Data(#"{"error":{"code":"\#(code.rawValue)","message":"refused"}}"#.utf8)
        return .server(status: 401, response: try FardeskJSON.makeDecoder().decode(ErrorResponse.self, from: body))
    }

    @Test func revokedAndUnauthorizedTokensAndMissingTokensMeanLoggedOut() throws {
        #expect(try refused(.tokenRevoked).meansLoggedOut)
        #expect(try refused(.unauthorized).meansLoggedOut)
        #expect(MachineAccessError.notLoggedIn(machine: "Mac").meansLoggedOut)
    }

    @Test func otherFailuresDoNotMeanLoggedOut() throws {
        #expect(try !refused(.conflict).meansLoggedOut)
        #expect(!FardeskAPIError.transport(URLError(.timedOut)).meansLoggedOut)
        #expect(!URLError(.notConnectedToInternet).meansLoggedOut)
    }

    @Test func revokedTokenShowsLoggedOutNotOffline() throws {
        var machine = MachineState(endpoint: endpoint)
        machine.markFailed(by: try refused(.tokenRevoked), now: now)
        #expect(machine.connection == .loggedOut)
        let presentation = MachinePresentation(machine: machine, now: now)
        #expect(presentation.statusLabel == "Logged out")
        #expect(!presentation.isOnline && presentation.isDimmed && presentation.lastSeenLabel == nil)
    }

    @Test func unreachableMachineStillShowsOffline() {
        var machine = MachineState(endpoint: endpoint)
        machine.markFailed(by: FardeskAPIError.transport(URLError(.cannotConnectToHost)), now: now)
        #expect(machine.connection == .offline(lastSeen: nil))
        #expect(MachinePresentation(machine: machine, now: now).statusLabel == "Offline")
    }

    @Test func aDisconnectDoesNotTurnLoggedOutBackIntoOffline() throws {
        var machine = MachineState(endpoint: endpoint)
        machine.markFailed(by: try refused(.unauthorized), now: now)
        machine.markOffline(now: now)
        #expect(machine.connection == .loggedOut)
    }
}
