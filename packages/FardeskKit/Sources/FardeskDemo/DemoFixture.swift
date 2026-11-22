import FardeskModels
import Foundation

/// The demo world file (`Resources/Demo/world.json`), written by the project's demo fixture generator from the same
/// invented conversations the demo daemons serve. Times in it are "seconds ago"; loading shifts them to `now`.
struct DemoFixture {
    struct MachineRecord {
        let key: String
        let machine: Machine
        let folders: [RecentFolder]
    }

    struct SessionRecord {
        let machine: String
        var summary: SessionSummary
        var activities: [Activity]
        let details: [String: ActivityDetail]
    }

    let machines: [MachineRecord]
    let sessions: [SessionRecord]

    static let fileName = "world"
    static let imageName = "hero"

    static func resource(_ name: String, _ ext: String) throws -> Data {
        guard let url = Bundle.module.url(forResource: name, withExtension: ext, subdirectory: "Demo") else {
            throw DemoError.fixtureMissing("\(name).\(ext)")
        }
        return try Data(contentsOf: url)
    }

    static func load(now: Date) throws -> DemoFixture {
        let root = try DemoJSON.object(resource(fileName, "json"))
        guard let machines = root["machines"] as? [[String: Any]], let sessions = root["sessions"] as? [[String: Any]] else {
            throw DemoError.fixtureInvalid("machines or sessions are missing")
        }
        return DemoFixture(machines: try machines.map { try machine($0, now: now) }, sessions: try sessions.map { try session($0, now: now) })
    }

    private static func machine(_ raw: [String: Any], now: Date) throws -> MachineRecord {
        guard let key = raw["key"] as? String, let machine = raw["machine"], let folders = raw["folders"] as? [[String: Any]] else {
            throw DemoError.fixtureInvalid("a machine is incomplete")
        }
        let recent = try folders.map { folder -> RecentFolder in
            let path = folder["path"] as? String ?? ""
            return try DemoJSON.decode(from: ["path": path, "lastUsedAt": DemoJSON.iso(ago(folder["agoSec"], from: now))])
        }
        return MachineRecord(key: key, machine: try DemoJSON.decode(from: machine), folders: recent)
    }

    private static func session(_ raw: [String: Any], now: Date) throws -> SessionRecord {
        guard let machine = raw["machine"] as? String, var summary = raw["summary"] as? [String: Any],
              let rows = raw["activities"] as? [[String: Any]], let details = raw["details"] as? [String: Any] else {
            throw DemoError.fixtureInvalid("a session is incomplete")
        }
        summary["startedAt"] = DemoJSON.iso(ago(summary.removeValue(forKey: "startedAgoSec"), from: now))
        summary["updatedAt"] = DemoJSON.iso(ago(summary.removeValue(forKey: "updatedAgoSec"), from: now))
        let expiresIn = summary.removeValue(forKey: "cacheExpiresInSec") as? Double
        summary["cacheExpiresAt"] = DemoJSON.orNull(expiresIn.map { DemoJSON.iso(now.addingTimeInterval($0)) })
        // The demo cache bucket is one hour: the last turn ended an hour before the cache runs out.
        summary["lastTurnAt"] = DemoJSON.orNull(expiresIn.map { DemoJSON.iso(now.addingTimeInterval($0 - 3_600)) })
        let activities = try rows.map { row -> Activity in
            var shifted = row
            shifted["ts"] = DemoJSON.iso(ago(row["ts"], from: now))
            return try DemoJSON.decode(from: shifted)
        }
        return SessionRecord(
            machine: machine, summary: try DemoJSON.decode(from: summary), activities: activities,
            details: try details.mapValues { try DemoJSON.decode(ActivityDetail.self, from: $0) }
        )
    }

    private static func ago(_ seconds: Any?, from now: Date) -> Date {
        now.addingTimeInterval(-((seconds as? Double) ?? 0))
    }
}
