import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

struct PairingLinkTests {
    private func link(_ json: String) -> String {
        "fardesk://pair?d=" + Base64URL.encode(Data(json.utf8))
    }

    @Test(arguments: ["tailnet", "hub"])
    func makeThenParseRoundTripsFixtures(name: String) throws {
        let payload = try Fixtures.decode(PairingPayload.self, "PairingPayload", name)
        let text = try PairingLink.make(payload)
        #expect(text.hasPrefix("fardesk://pair?d="))
        #expect(!text.dropFirst("fardesk://pair?d=".count).contains("="))
        #expect(try PairingLink.parse(text) == payload)
    }

    @Test func parseToleratesSurroundingWhitespace() throws {
        let payload = try Fixtures.decode(PairingPayload.self, "PairingPayload", "tailnet")
        let text = try PairingLink.make(payload)
        #expect(try PairingLink.parse("  \(text)\n") == payload)
    }

    @Test func endpointIsBuiltFromPayload() throws {
        let payload = try Fixtures.decode(PairingPayload.self, "PairingPayload", "tailnet")
        let id = UUID()
        let endpoint = MachineEndpoint(payload: payload, id: id)
        #expect(endpoint.id == id)
        #expect(endpoint.name == payload.name)
        #expect(endpoint.url == payload.url)
        #expect(MachineEndpoint(payload: payload).id != id)
    }

    @Test(arguments: [
        "https://pair?d=abc",
        "fardesk://other?d=abc",
        "not a link at all",
        "",
    ])
    func rejectsNonFardeskLinks(text: String) {
        #expect(throws: PairingError.notAFardeskLink) { try PairingLink.parse(text) }
    }

    @Test(arguments: ["fardesk://pair", "fardesk://pair?d=", "fardesk://pair?x=1"])
    func rejectsMissingPayload(text: String) {
        #expect(throws: PairingError.missingPayload) { try PairingLink.parse(text) }
    }

    @Test(arguments: ["fardesk://pair?d=!!!!", "fardesk://pair?d=A"])
    func rejectsInvalidBase64(text: String) {
        #expect(throws: PairingError.invalidBase64) { try PairingLink.parse(text) }
    }

    @Test func rejectsPayloadThatIsNotAPairing() {
        #expect(throws: PairingError.invalidPayload) { try PairingLink.parse(link("{}")) }
        #expect(throws: PairingError.invalidPayload) { try PairingLink.parse(link("[1,2")) }
    }

    @Test func everyErrorHasAShortDescription() {
        let all: [PairingError] = [.notAFardeskLink, .missingPayload, .invalidBase64, .invalidPayload]
        let descriptions = all.compactMap(\.errorDescription)
        #expect(descriptions.count == 4)
        #expect(Set(descriptions).count == 4)
        #expect(descriptions.allSatisfy { $0.count < 80 })
    }
}

struct MachineListTests {
    private let linux = Fixtures.endpoint("Linux", host: "100.64.0.1")
    private let mac = Fixtures.endpoint("Mac mini Pro", host: "100.64.0.2")
    private let macM2 = Fixtures.endpoint("Mac Studio M2", host: "100.64.0.3")

    @Test func addAppendsNewUrlsAndReplacesSameUrl() {
        var list = MachineList()
        list.add(linux)
        list.add(mac)
        let renamed = MachineEndpoint(id: UUID(), name: "Linux 2", url: linux.url)
        list.add(renamed)
        #expect(list.endpoints == [renamed, mac])
    }

    @Test func findMatchesCaseInsensitiveUniquePrefix() throws {
        let list = MachineList(endpoints: [linux, mac, macM2])
        #expect(try list.find(named: "lin") == linux)
        #expect(try list.find(named: "LINUX") == linux)
        #expect(try list.find(named: "mac mini p") == mac)
    }

    @Test func exactNameWinsOverLongerNames() throws {
        let longer = Fixtures.endpoint("Linux2", host: "100.64.0.9")
        let list = MachineList(endpoints: [longer, linux])
        #expect(try list.find(named: "linux") == linux)
    }

    @Test func ambiguousPrefixListsCandidates() {
        let list = MachineList(endpoints: [linux, mac, macM2])
        #expect(throws: MachineListError.ambiguous(query: "mac", candidates: ["Mac mini Pro", "Mac Studio M2"])) {
            try list.find(named: "mac")
        }
    }

    @Test func unknownNameListsAvailableMachines() {
        let list = MachineList(endpoints: [linux, mac])
        #expect(throws: MachineListError.unknown(query: "win", available: ["Linux", "Mac mini Pro"])) {
            try list.find(named: "win")
        }
        #expect(throws: MachineListError.unknown(query: "", available: ["Linux", "Mac mini Pro"])) {
            try list.find(named: "")
        }
    }

    @Test func removeReturnsTheRemovedMachine() throws {
        var list = MachineList(endpoints: [linux, mac])
        #expect(try list.remove(named: "lin") == linux)
        #expect(list.endpoints == [mac])
        #expect(throws: MachineListError.self) { try list.remove(named: "lin") }
    }

    @Test func errorDescriptionsNameTheProblem() {
        let unknown = MachineListError.unknown(query: "x", available: ["A", "B"]).errorDescription
        let none = MachineListError.unknown(query: "x", available: []).errorDescription
        let ambiguous = MachineListError.ambiguous(query: "m", candidates: ["Ma", "Mb"]).errorDescription
        #expect(unknown == "No machine named \"x\" (machines: A, B)")
        #expect(none == "No machine named \"x\" (machines: none paired)")
        #expect(ambiguous == "\"m\" matches several machines: Ma, Mb")
    }

    @Test func duplicateExactNamesAreAmbiguous() {
        let twin = Fixtures.endpoint("Linux", host: "100.64.0.50")
        let list = MachineList(endpoints: [linux, twin])
        #expect(throws: MachineListError.ambiguous(query: "linux", candidates: ["Linux", "Linux"])) {
            try list.find(named: "linux")
        }
    }
}

struct MachineListFileTests {
    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "fardesk-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func mode(of url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return try #require(attributes[.posixPermissions] as? Int)
    }

    @Test func missingFileLoadsAsEmptyList() throws {
        let file = MachineListFile(url: try temporaryDirectory().appending(path: "machines.json"))
        #expect(try file.load() == MachineList())
    }

    /// A list written before 4.0.0 stored the hub as a plain URL string. Loading it must say what to do, not
    /// "the data isn't in the correct format" (owner's CLI, 2026-11-22).
    @Test func anOldFormatListSaysToPairAgain() throws {
        let url = try temporaryDirectory().appending(path: "machines.json")
        try Data(#"{"endpoints":[],"hub":"http://100.64.0.5:4780"}"#.utf8).write(to: url)
        #expect(throws: MachineListError.unreadableFile(path: url.path)) { try MachineListFile(url: url).load() }
        #expect(MachineListError.unreadableFile(path: "/x").errorDescription?.contains("fardesk pair <link>") == true)
    }

    @Test func saveCreatesParentDirectoryWithOwnerOnlyMode() throws {
        let url = try temporaryDirectory().appending(path: "nested/dir/machines.json")
        let file = MachineListFile(url: url)
        let list = MachineList(endpoints: [Fixtures.endpoint("Linux")])
        try file.save(list)
        #expect(try mode(of: url) == 0o600)
        #expect(try file.load() == list)
    }

    @Test func secondSaveReplacesAtomicallyAndKeepsMode() throws {
        let directory = try temporaryDirectory()
        let url = directory.appending(path: "machines.json")
        let file = MachineListFile(url: url)
        try file.save(MachineList(endpoints: [Fixtures.endpoint("Linux")]))
        let second = MachineList(endpoints: [Fixtures.endpoint("Mac", host: "100.64.0.7")])
        try file.save(second)
        #expect(try file.load() == second)
        #expect(try mode(of: url) == 0o600)
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        #expect(leftovers == ["machines.json"])
    }

    @Test func corruptFileThrowsInsteadOfBeingIgnored() throws {
        let url = try temporaryDirectory().appending(path: "machines.json")
        try Data("not json".utf8).write(to: url)
        #expect(throws: (any Error).self) { try MachineListFile(url: url).load() }
    }

    @Test func failedReplaceThrowsAndRemovesTheTemporaryFile() throws {
        let directory = try temporaryDirectory()
        let blocker = directory.appending(path: "machines.json")
        try FileManager.default.createDirectory(at: blocker, withIntermediateDirectories: true)
        let file = MachineListFile(url: blocker)
        var caught: AtomicFileError?
        do { try file.save(MachineList()) } catch let error as AtomicFileError { caught = error }
        guard case .replaceFailed(let path, let code) = try #require(caught) else { return }
        #expect(path == blocker.path)
        #expect(code != 0)
        #expect(caught?.errorDescription?.hasPrefix("Could not write \(blocker.path)") == true)
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path) == ["machines.json"])
    }

    @Test func defaultPathUsesEnvironmentOverrideOrHomeConfig() {
        let home = URL(filePath: "/Users/someone")
        let override = MachineListFile.defaultURL(environment: ["FARDESK_MACHINES": "/tmp/m.json"], home: home)
        let empty = MachineListFile.defaultURL(environment: ["FARDESK_MACHINES": ""], home: home)
        let unset = MachineListFile.defaultURL(environment: [:], home: home)
        #expect(override.path == "/tmp/m.json")
        #expect(empty.path == "/Users/someone/.config/fardesk/machines.json")
        #expect(unset == empty)
    }
}
