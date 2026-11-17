import Foundation

/// Reconnect delays: `initial` doubling up to `maximum`, spread by `jitter` (a fraction of the delay).
public struct BackoffPolicy: Sendable, Equatable {
    public static let standard = BackoffPolicy(initial: 1, maximum: 30, jitter: 0.25)

    public let initial: TimeInterval
    public let maximum: TimeInterval
    public let jitter: Double

    public init(initial: TimeInterval, maximum: TimeInterval, jitter: Double) {
        self.initial = initial
        self.maximum = maximum
        self.jitter = jitter
    }

    /// The delay before reconnect attempt `attempt` (0 = first retry). `unit` in 0...1 picks the
    /// point inside the jitter band: 0 = shortest, 1 = longest, 0.5 = the plain doubled delay.
    public func delay(attempt: Int, unit: Double) -> TimeInterval {
        let exponent = Double(min(max(attempt, 0), 62))
        let base = min(maximum, initial * pow(2, exponent))
        let spread = 1 + jitter * (2 * min(max(unit, 0), 1) - 1)
        return base * spread
    }

    public func delay(attempt: Int) -> TimeInterval {
        delay(attempt: attempt, unit: Double.random(in: 0...1))
    }
}
