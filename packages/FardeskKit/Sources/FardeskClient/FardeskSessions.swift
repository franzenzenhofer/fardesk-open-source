import Foundation

/// The two URLSessions of the app: one for the short HTTP calls, one for the long-lived WebSockets. Separate
/// sessions so a slow stream never queues behind (or in front of) a tap's request, and each has the timeouts it needs.
public enum FardeskSessions {
    /// The daemon pings every 20 s; a stream must survive three missed pings before the system gives up on it.
    public static let daemonPingInterval: TimeInterval = 20
    public static let streamTimeout: TimeInterval = 3 * daemonPingInterval

    public static let http: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpMaximumConnectionsPerHost = 6
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    public static let stream: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = streamTimeout
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()
}
