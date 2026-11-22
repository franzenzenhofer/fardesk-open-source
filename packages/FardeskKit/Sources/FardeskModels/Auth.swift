import Foundation

/// A machine a daemon tells its clients about, so one reachable machine is enough to find the others.
public struct Peer: Codable, Sendable, Hashable {
    public let name: String
    public let url: URL

    public init(name: String, url: URL) {
        self.name = name
        self.url = url
    }
}

/// `POST /v1/auth/pair` (no bearer): the one-time code of a pairing link in exchange for a device token.
public struct PairRequest: Codable, Sendable, Hashable {
    public let code: String
    public let deviceName: String

    public init(code: String, deviceName: String) {
        self.code = code
        self.deviceName = deviceName
    }
}

/// `POST /v1/auth/pair-code`: a fresh single-use code for a pairing link.
public struct PairCodeResult: Codable, Sendable, Hashable {
    public let code: String
    public let expiresAt: Date
}

public struct LoginResult: Codable, Sendable, Hashable {
    public let token: String
    public let deviceId: String
    public let machine: Machine
    public let peers: [Peer]

    public init(token: String, deviceId: String, machine: Machine, peers: [Peer]) {
        self.token = token
        self.deviceId = deviceId
        self.machine = machine
        self.peers = peers
    }
}

/// `apnsToken` is always on the wire, `null` when the device has no push registration.
public struct LogoutRequest: Codable, Sendable, Hashable {
    public let apnsToken: String?

    public init(apnsToken: String?) {
        self.apnsToken = apnsToken
    }

    private enum CodingKeys: String, CodingKey {
        case apnsToken
    }

    public init(from decoder: any Decoder) throws {
        apnsToken = try decoder.container(keyedBy: CodingKeys.self).decode(String?.self, forKey: .apnsToken)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(apnsToken, forKey: .apnsToken)
    }
}

public struct AuthDevice: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let createdAt: Date
    public let lastSeenAt: Date?
    public let lastIp: String?
    public let revoked: Bool
    public let current: Bool

    private enum CodingKeys: String, CodingKey {
        case id, name, createdAt, lastSeenAt, lastIp, revoked, current
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        lastSeenAt = try c.decode(Date?.self, forKey: .lastSeenAt)
        lastIp = try c.decode(String?.self, forKey: .lastIp)
        revoked = try c.decode(Bool.self, forKey: .revoked)
        current = try c.decode(Bool.self, forKey: .current)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(lastSeenAt, forKey: .lastSeenAt)
        try c.encode(lastIp, forKey: .lastIp)
        try c.encode(revoked, forKey: .revoked)
        try c.encode(current, forKey: .current)
    }
}

public struct AuthDeviceList: Codable, Sendable, Hashable {
    public let devices: [AuthDevice]
}

/// `device` is an id or a device name; `nil` revokes every device. Always on the wire.
public struct RevokeRequest: Codable, Sendable, Hashable {
    public let device: String?

    public init(device: String?) {
        self.device = device
    }

    private enum CodingKeys: String, CodingKey {
        case device
    }

    public init(from decoder: any Decoder) throws {
        device = try decoder.container(keyedBy: CodingKeys.self).decode(String?.self, forKey: .device)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(device, forKey: .device)
    }
}

public struct RevokeResult: Codable, Sendable, Hashable {
    public let revoked: Int
}
