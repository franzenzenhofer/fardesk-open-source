import FardeskModels
import Foundation

/// The lifeline of docs/VERSIONING.md, section 5: three routes that keep their shape in every major.
extension FardeskAPI {
    /// A release package carries about 2 MB; relaying it to a slow machine can take longer than the usual call.
    public static let updateTimeout: TimeInterval = 300
    public static let updateSha256Header = "X-Fardesk-Package-Sha256"

    /// The release package this machine runs (the gzip tarball its own installer used).
    public func updatePackage() async throws -> Data {
        try await sendRaw(APIRequest(method: .get, segments: ["v1", "update", "package"], timeout: Self.updateTimeout))
    }

    /// Posts a release package; the machine checks `sha256` (hex), answers at once and installs in the background.
    public func installUpdate(package: Data, sha256: String) async throws {
        let request = APIRequest(
            method: .post, segments: ["v1", "machine", "update"], body: package, contentType: "application/gzip",
            headers: [Self.updateSha256Header: sha256], timeout: Self.updateTimeout
        )
        let started: MachineUpdateResult = try await send(request)
        guard started.ok else { throw FardeskAPIError.decoding("the machine did not take the update") }
    }

    /// Asks the hub to fetch the package from the newest machine and push it to every older one.
    public func hubUpdateAll() async throws -> HubUpdateResult {
        try await send(APIRequest(method: .post, segments: ["v1", "hub", "update-all"], timeout: Self.updateTimeout))
    }
}

