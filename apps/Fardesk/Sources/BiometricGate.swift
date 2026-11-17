import Foundation
import LocalAuthentication

/// Asks for Face ID (or the device passcode) before a destructive action, when the setting is on.
enum BiometricGate {
    static func confirm(reason: String) async -> Bool {
        guard UserDefaults.standard.bool(forKey: AppServices.requireFaceIDKey) else { return true }
        let context = LAContext()
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false
        }
    }
}
