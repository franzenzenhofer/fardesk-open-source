import FardeskModels
import Foundation

/// One HTTP call: everything the request core needs, nothing about the route's meaning.
struct APIRequest {
    enum Method: String {
        case get = "GET"
        case post = "POST"
    }

    let method: Method
    let segments: [String]
    var query: [URLQueryItem] = []
    var body: Data?
    /// Defaults to JSON; attachments send raw bytes with their own media type.
    var contentType = "application/json"
    var headers: [String: String] = [:]
    /// Overrides the client's timeout for calls that legitimately take long (see `FardeskAPI.slowTimeout`).
    var timeout: TimeInterval?
}

/// The HTTP client for one machine. One generic request core, one method per daemon route.
public struct FardeskAPI: Sendable {
    public static let defaultTimeout: TimeInterval = 15
    /// Starting a Claude session (new, fork, resume, take over) waits for Claude to come up, and an
    /// upload can be 20 MB: on a busy machine both take longer than `defaultTimeout`.
    public static let slowTimeout: TimeInterval = 120

    public let baseURL: URL
    public let token: String?
    public let timeout: TimeInterval
    private let session: URLSession

    public init(baseURL: URL, token: String?, timeout: TimeInterval = defaultTimeout, session: URLSession = FardeskSessions.http) {
        self.baseURL = baseURL
        self.token = token
        self.timeout = timeout
        self.session = session
    }

    /// The body of a 2xx answer as it came, for routes that return bytes instead of JSON.
    func sendRaw(_ request: APIRequest) async throws -> Data {
        let (data, response) = try await transfer(urlRequest(for: request))
        guard let http = response as? HTTPURLResponse else {
            throw FardeskAPIError.decoding("not an HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw serverError(status: http.statusCode, data: data)
        }
        return data
    }

    func send<Response: Decodable>(_ request: APIRequest, as type: Response.Type = Response.self) async throws -> Response {
        let data = try await sendRaw(request)
        do {
            return try FardeskJSON.makeDecoder().decode(Response.self, from: data)
        } catch {
            throw FardeskAPIError.decoding(String(describing: error))
        }
    }

    /// The base URL's own path (a hub serves machine `x` under `/m/x`), without a trailing slash.
    var pathPrefix: String {
        var prefix = baseURL.path(percentEncoded: true)
        while prefix.hasSuffix("/") { prefix.removeLast() }
        return prefix
    }

    func json<Body: Encodable>(_ body: Body) throws -> Data {
        try FardeskJSON.makeEncoder().encode(body)
    }

    private func transfer(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError where error.code != .cancelled {
            throw FardeskAPIError.transport(error)
        }
    }

    private func serverError(status: Int, data: Data) -> FardeskAPIError {
        guard let response = try? FardeskJSON.makeDecoder().decode(ErrorResponse.self, from: data) else {
            return .decoding("HTTP \(status) without a contract error body")
        }
        return .server(status: status, response: response)
    }

    private func urlRequest(for request: APIRequest) throws -> URLRequest {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        let encoded = request.segments.map(Self.encode).joined(separator: "/")
        components?.percentEncodedPath = pathPrefix + "/" + encoded
        components?.queryItems = request.query.isEmpty ? nil : request.query
        guard let url = components?.url else { throw FardeskAPIError.decoding("bad URL for \(baseURL)") }
        var urlRequest = URLRequest(url: url, timeoutInterval: request.timeout ?? timeout)
        urlRequest.httpMethod = request.method.rawValue
        urlRequest.httpBody = request.body
        if request.body != nil { urlRequest.setValue(request.contentType, forHTTPHeaderField: "Content-Type") }
        request.headers.forEach { urlRequest.setValue($1, forHTTPHeaderField: $0) }
        if let token { urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return urlRequest
    }

    private static let segmentAllowed: CharacterSet = {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return allowed
    }()

    private static func encode(_ segment: String) -> String {
        segment.addingPercentEncoding(withAllowedCharacters: segmentAllowed) ?? segment
    }
}
