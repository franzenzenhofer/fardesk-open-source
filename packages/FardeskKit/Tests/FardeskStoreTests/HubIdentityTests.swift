import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

struct HubIdentityTests {
    private let hub = URL(string: "http://100.64.0.10:4780")!

    @Test func machineIDsAreStableAndDistinctPerName() {
        let linux = HubIdentity.machineID(name: "Demo Box")
        #expect(linux == HubIdentity.machineID(name: "Demo Box"))
        #expect(linux != HubIdentity.machineID(name: "Mac mini Pro"))
        #expect(linux.uuidString.lowercased().dropFirst(14).first == "5", "a version 5 (name-based) id")
        // Pinned: a changed derivation would orphan every cache and selection on every device.
        #expect(linux.uuidString == "9C43E687-C489-5C91-B86A-BFA972587160")
    }

    @Test func endpointURLIsHubSlashMSlashEncodedName() {
        let endpoint = HubIdentity.endpoint(machine: "Mac mini Pro", hub: hub)
        #expect(endpoint.url.absoluteString == "http://100.64.0.10:4780/m/Mac%20mini%20Pro")
        #expect(endpoint.id == HubIdentity.machineID(name: "Mac mini Pro"))
        #expect(endpoint.name == "Mac mini Pro")
        let slash = HubIdentity.machineURL(name: "a/b", hub: URL(string: "http://h:1/prefix/")!)
        #expect(slash.absoluteString == "http://h:1/prefix/m/a%2Fb")
    }

    @Test func tokenIDDependsOnTheHubOnly() {
        #expect(HubIdentity.tokenID(hub: hub) == HubIdentity.tokenID(hub: hub))
        #expect(HubIdentity.tokenID(hub: hub) != HubIdentity.tokenID(hub: URL(string: "http://other:4780")!))
        #expect(HubIdentity.tokenID(hub: hub) != HubIdentity.machineID(name: hub.absoluteString))
    }

    @Test func endpointsFollowTheHubOrder() throws {
        let state = HubState(hub: "Linux", checkedAt: Date(), machines: [
            HubMachine(name: "Linux", online: true, hub: true), HubMachine(name: "Mac mini Pro", online: false),
        ])
        #expect(HubIdentity.endpoints(of: state, hub: hub).map(\.name) == ["Linux", "Mac mini Pro"])
    }

    @Test func machineListKeepsTheHubKeyInItsFileAndDropsEndpointsWhenTheHubChanges() throws {
        try StoreSandboxFiles.run { file in
            var list = MachineList()
            list.setHub(hub)
            list.replaceEndpoints([HubIdentity.endpoint(machine: "Linux", hub: hub)])
            try file.save(list)
            let text = String(decoding: try Data(contentsOf: file.url), as: UTF8.self)
            #expect(text.contains("\"hub\""))
            var loaded = try file.load()
            #expect(loaded == list)
            loaded.setHub(hub)
            #expect(loaded.endpoints.count == 1, "the same hub keeps its machines")
            loaded.setHub(URL(string: "http://elsewhere:4780")!)
            #expect(loaded.endpoints.isEmpty)
            loaded.setHub(nil)
            #expect(loaded.hub == nil)
        }
    }

    @Test func aMachineFileWithoutAHubKeyStillLoads() throws {
        try StoreSandboxFiles.run { file in
            try Data(#"{"endpoints":[]}"#.utf8).write(to: file.url)
            #expect(try file.load().hub == nil)
        }
    }

    @Test func hubSettingAcceptsOnlyHTTPAddresses() {
        #expect(HubSetting.parse("http://100.64.0.10:4780")?.port == 4780)
        #expect(HubSetting.parse("") == nil)
        #expect(HubSetting.parse("ftp://x") == nil)
        #expect(HubSetting.parse("not a url") == nil)
    }
}

/// A machine file in a fresh temp directory.
enum StoreSandboxFiles {
    static func run(_ body: (MachineListFile) throws -> Void) throws {
        let sandbox = try StoreSandbox()
        try body(MachineListFile(url: sandbox.root.appending(path: "hub-machines.json")))
    }
}
