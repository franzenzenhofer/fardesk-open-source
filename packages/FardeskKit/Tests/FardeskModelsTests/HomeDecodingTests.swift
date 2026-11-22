import FardeskModels
import Foundation
import Testing

struct HomeDecodingTests {
    private func data(_ contract: String, _ name: String) throws -> Data {
        try Data(contentsOf: FixtureCatalog.fixturesDirectory.appending(path: "\(contract)/\(name).json"))
    }

    private func decode<T: Decodable>(_ type: T.Type, _ contract: String, _ name: String) throws -> T {
        try FardeskJSON.makeDecoder().decode(type, from: data(contract, name))
    }

    @Test func aSessionDecodesItsHomeNameOrNil() throws {
        #expect(try decode(SessionSummary.self, "SessionSummary", "working").home == "team")
        #expect(try decode(SessionSummary.self, "SessionSummary", "waitingPermission").home == nil)
    }

    @Test func aMachineDecodesTheNamesOfItsHomes() throws {
        #expect(try decode(Machine.self, "Machine", "macosWithClaude").homes == [".claude", "team"])
        #expect(try decode(Machine.self, "Machine", "linuxWithoutClaude").homes == [".claude"])
    }

    @Test func aSessionWithoutTheHomeKeyIsRefused() throws {
        let object = try JSONSerialization.jsonObject(with: data("SessionSummary", "working"))
        var dictionary = try #require(object as? [String: Any])
        dictionary["home"] = nil
        let patched = try JSONSerialization.data(withJSONObject: dictionary)
        #expect(throws: DecodingError.self) { try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: patched) }
    }

    @Test func aNewSessionRequestSendsTheHomeOnlyWhenOneIsChosen() throws {
        let plain = NewSessionRequest(cwd: "/Users/dev/app", prompt: "go", worktree: false, model: nil)
        let named = NewSessionRequest(cwd: "/Users/dev/app", prompt: "go", worktree: false, model: nil, home: "team")
        let encoder = FardeskJSON.makeEncoder()
        #expect(try String(decoding: encoder.encode(plain), as: UTF8.self).contains("\"home\"") == false)
        #expect(try String(decoding: encoder.encode(named), as: UTF8.self).contains("\"home\":\"team\""))
        #expect(try decode(NewSessionRequest.self, "NewSessionRequest", "inNamedHome").home == "team")
    }
}
