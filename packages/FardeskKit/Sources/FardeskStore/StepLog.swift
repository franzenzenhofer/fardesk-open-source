import Foundation

/// A small visible activity log: what the app is doing right now, step by step, so no wait is silent.
public struct StepLog: Equatable, Sendable {
    public enum State: Equatable, Sendable {
        case running
        case done
        case failed(String)
    }

    public struct Step: Equatable, Sendable, Identifiable {
        public let id: Int
        public let text: String
        public let state: State

        /// "checkmark.circle.fill", "xmark.circle.fill" or nil while running (the view shows a spinner).
        public var symbolName: String? {
            switch state {
            case .running: nil
            case .done: "checkmark.circle.fill"
            case .failed: "xmark.circle.fill"
            }
        }

        /// The step with its reason when it failed: "Starting Claude on Linux: not found".
        public var displayText: String {
            if case .failed(let reason) = state { return "\(text): \(reason)" }
            return text
        }
    }

    public private(set) var steps: [Step] = []
    private var nextID = 0

    public init() {}

    public var isEmpty: Bool { steps.isEmpty }
    public var isRunning: Bool { steps.contains { $0.state == .running } }
    public var hasFailure: Bool { steps.contains { if case .failed = $0.state { true } else { false } } }

    /// Adds a running step and returns its id.
    @discardableResult
    public mutating func begin(_ text: String) -> Int {
        let id = nextID
        nextID += 1
        steps.append(Step(id: id, text: text, state: .running))
        return id
    }

    /// Ends a step as done, optionally with new text ("Session started (abc123)").
    public mutating func finish(_ id: Int, as text: String? = nil) {
        replace(id) { Step(id: $0.id, text: text ?? $0.text, state: .done) }
    }

    public mutating func fail(_ id: Int, reason: String) {
        replace(id) { Step(id: $0.id, text: $0.text, state: .failed(reason)) }
    }

    public mutating func remove(_ id: Int) {
        steps.removeAll { $0.id == id }
    }

    /// Drops failed steps whose text starts with `prefix`: a later attempt of the same thing worked, so the old
    /// failure is no longer true and must not stay on screen.
    public mutating func dropFailures(matching prefix: String) {
        steps.removeAll { step in
            if case .failed = step.state { step.text.hasPrefix(prefix) } else { false }
        }
    }

    /// Finishes every step still running (a late row proves the wait is over).
    public mutating func finishRunning() {
        steps = steps.map { $0.state == .running ? Step(id: $0.id, text: $0.text, state: .done) : $0 }
    }

    /// Whether the log still belongs on screen: something runs or failed, or the feed has no rows yet.
    public func isVisible(feedHasRows: Bool) -> Bool {
        !steps.isEmpty && (isRunning || hasFailure || !feedHasRows)
    }

    private mutating func replace(_ id: Int, _ change: (Step) -> Step) {
        guard let index = steps.firstIndex(where: { $0.id == id }) else { return }
        steps[index] = change(steps[index])
    }
}

extension SessionRef {
    private static let startingPrefix = "starting:"

    /// Stands for "the session that is being started": the screen opens before the machine answers.
    public static func starting(on machineID: UUID) -> SessionRef {
        SessionRef(machineID: machineID, sessionID: startingPrefix + UUID().uuidString)
    }

    public var isStarting: Bool { sessionID.hasPrefix(Self.startingPrefix) }
}
