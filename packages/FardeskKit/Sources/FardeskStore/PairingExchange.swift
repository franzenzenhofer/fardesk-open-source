import FardeskClient
import FardeskModels
import Foundation

/// Turns a pairing link into the bearer token this device uses from then on.
public enum PairingExchange {
    /// An old link already holds a token and is used as is. A link with a one-time code is exchanged at the
    /// daemon for a device token of its own (revocable, with remote wipe); the code is spent by that call.
    public static func token(for payload: PairingPayload, deviceName: String, access: MachineAccess) async throws -> String {
        if let token = payload.token { return token }
        guard let code = payload.code else { throw PairingError.invalidPayload }
        let api = FardeskAPI(baseURL: access.rebased(payload.url), token: nil, timeout: access.timeout)
        return try await api.pair(code: code, deviceName: deviceName).token
    }
}
