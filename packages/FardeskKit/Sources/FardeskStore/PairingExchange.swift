import FardeskClient
import FardeskModels
import Foundation

/// Turns a pairing link into the bearer token this device uses from then on.
public enum PairingExchange {
    /// The one-time code of the link is exchanged at the daemon for a device token of its own (revocable, with
    /// remote wipe); the code is spent by that call.
    public static func token(for payload: PairingPayload, deviceName: String, access: MachineAccess) async throws -> String {
        let api = FardeskAPI(baseURL: access.rebased(payload.url), token: nil, timeout: access.timeout)
        return try await api.pair(code: payload.code, deviceName: deviceName).token
    }
}
