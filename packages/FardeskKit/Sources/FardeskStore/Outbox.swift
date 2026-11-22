import FardeskModels
import Foundation

/// A message the user sent: it shows in the feed the moment it is tapped and its state updates in place.
public struct PendingMessage: Identifiable, Sendable {
    public enum Kind: Sendable, Equatable {
        /// A reply to the session.
        case reply
        /// The first message to the coordinator (starts its session).
        case coordinator
    }

    public enum State: Equatable, Sendable {
        /// Accepted by the app, not on its way yet (or waiting for the machine to come back).
        case queued(waitingFor: String?)
        case sending
        /// The computer took it; Claude is busy, so it waits for the current turn (one grey check).
        case sent
        /// It is in the Claude session (one blue check). "Claude got it" (two blue checks) comes from the transcript.
        case delivered
        case failed(String)
    }

    public let id: UUID
    public let ref: SessionRef
    public let message: OutgoingMessage
    public let kind: Kind
    public let createdAt: Date
    /// The user rows the feed already had when the message was written: none of them can be this message arriving.
    public let knownRows: Set<String>
    public internal(set) var state: State

    public var text: String { message.textToSend }

    /// "Queued", "Sending...", "Sent", "Not sent: <reason>".
    public var statusLabel: String {
        switch state {
        case .queued(let machine?): "Queued - waiting for \(machine)"
        case .queued(nil): "Queued"
        case .sending: "Sending..."
        case .sent: "Sent"
        case .delivered: "Delivered"
        case .failed(let reason): "Not sent: \(reason)"
        }
    }

    public var symbolName: String {
        switch state {
        case .queued: "clock"
        case .sending: "arrow.up.circle"
        case .sent, .delivered: "checkmark"
        case .failed: "exclamationmark.triangle.fill"
        }
    }

    public var canRetry: Bool {
        if case .failed = state { true } else { false }
    }

    public var isInFlight: Bool { state == .sending }
}

/// Messages on their way and the feed rows that proved a message arrived ("Claude got it").
public struct Outbox: Sendable {
    /// How far before the tap a transcript row may be stamped (clocks of two machines differ).
    public static let clockSkew: TimeInterval = 30
    public static let gotItLabel = "Claude got it"

    public private(set) var messages: [PendingMessage] = []
    public private(set) var deliveredRows: Set<String> = []

    public init() {}

    public func pending(for ref: SessionRef) -> [PendingMessage] {
        messages.filter { $0.ref == ref }
    }

    public func message(_ id: UUID) -> PendingMessage? {
        messages.first { $0.id == id }
    }

    public func queued(on machineID: UUID) -> [PendingMessage] {
        messages.filter { message in
            if case .queued = message.state { message.ref.machineID == machineID } else { false }
        }
    }

    @discardableResult
    public mutating func add(
        _ message: OutgoingMessage, to ref: SessionRef, kind: PendingMessage.Kind, at date: Date, knownRows: Set<String> = []
    ) -> UUID {
        let pending = PendingMessage(
            id: UUID(), ref: ref, message: message, kind: kind, createdAt: date, knownRows: knownRows, state: .queued(waitingFor: nil)
        )
        messages.append(pending)
        return pending.id
    }

    public mutating func set(_ id: UUID, _ state: PendingMessage.State) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[index].state = state
    }

    /// Reload chat: drops the bubbles of messages the computer already took (sent or delivered); the fresh page shows
    /// them as real rows. Queued and failed ones stay, they have not left this device.
    public mutating func dropSent(for ref: SessionRef) {
        messages.removeAll { $0.ref == ref && ($0.state == .sent || $0.state == .delivered) }
    }

    public mutating func remove(_ id: UUID) {
        messages.removeAll { $0.id == id }
    }

    /// Moves a message to the session it turned out to belong to (the coordinator's first message).
    public mutating func move(_ id: UUID, to ref: SessionRef) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        let old = messages[index]
        messages[index] = PendingMessage(
            id: old.id, ref: ref, message: old.message, kind: .reply, createdAt: old.createdAt, knownRows: old.knownRows, state: old.state
        )
    }

    /// A user row in the transcript that repeats a message in flight is that message arriving:
    /// the message leaves the outbox (so it is not shown twice) and the row is marked "Claude got it".
    public mutating func reconcile(_ ref: SessionRef, rows: [Activity]) {
        for pending in pending(for: ref) {
            let wanted = pending.text.trimmingCharacters(in: .whitespacesAndNewlines)
            let match = rows.first { row in
                guard case .user(let user) = row, !deliveredRows.contains(user.id), !pending.knownRows.contains(user.id) else { return false }
                // contains, not hasPrefix: messages sent while Claude is busy are queued, and Claude Code joins the
                // queued ones into one user turn ("<earlier words>See attached."), so ours may sit anywhere in it.
                return user.ts >= pending.createdAt.addingTimeInterval(-Self.clockSkew) && user.text.contains(wanted)
            }
            guard case .user(let user)? = match else { continue }
            deliveredRows.insert(user.id)
            remove(pending.id)
        }
    }

    public func isDelivered(rowID: String) -> Bool { deliveredRows.contains(rowID) }
}
