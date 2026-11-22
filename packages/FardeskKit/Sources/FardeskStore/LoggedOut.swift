import FardeskClient
import FardeskModels

extension Error {
    /// The machine refused the token (`token_revoked`, `unauthorized`) or this device has none:
    /// the machine shows as "Logged out", not as offline.
    public var meansLoggedOut: Bool {
        if let api = self as? FardeskAPIError {
            return api.code == .tokenRevoked || api.code == .unauthorized || api.code == .masterTokenWrongNode
        }
        return self is MachineAccessError
    }
}
