import Foundation

extension AppModel {
    /// The bytes of a picture or file the session's machine stored for a message, through the same
    /// authenticated path as every other call to that machine (also via the hub).
    public func attachmentData(in ref: SessionRef, path: String) async throws -> Data {
        guard let endpoint = machines.endpoints.first(where: { $0.id == ref.machineID }) else {
            throw AppStateError.unknownMachine(ref.machineID)
        }
        return try await access.api(for: endpoint).attachment(sessionID: ref.sessionID, path: path)
    }
}
