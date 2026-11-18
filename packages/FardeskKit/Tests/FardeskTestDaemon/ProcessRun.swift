import Foundation
import Synchronization

public struct ProcessResult: Sendable {
    public let status: Int32
    public let output: String
    public let error: String
}

/// One child process. Output is collected through readability handlers (no blocked threads),
/// so many children can run at once without starving the async runtime.
public final class RunningProcess: Sendable {
    private struct Collected {
        var output = Data()
        var error = Data()
        var status: Int32?
        var waiters: [CheckedContinuation<ProcessResult, Never>] = []

        var result: ProcessResult {
            ProcessResult(
                status: status ?? -1,
                output: String(decoding: output, as: UTF8.self),
                error: String(decoding: error, as: UTF8.self)
            )
        }
    }

    private final class Store: Sendable {
        let state = Mutex(Collected())
    }

    private let process = Process()
    private let store = Store()

    /// `environment` is added to (and overrides) this process's own environment.
    public init(executable: String, arguments: [String], stdin: String = "", environment: [String: String] = [:]) throws {
        let (outputPipe, errorPipe, inputPipe) = (Pipe(), Pipe(), Pipe())
        process.executableURL = URL(filePath: executable)
        process.arguments = arguments
        if !environment.isEmpty {
            process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, added in added }
        }
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        process.standardInput = inputPipe
        outputPipe.fileHandleForReading.readabilityHandler = { [store] in
            let chunk = $0.availableData
            store.state.withLock { $0.output.append(chunk) }
        }
        errorPipe.fileHandleForReading.readabilityHandler = { [store] in
            let chunk = $0.availableData
            store.state.withLock { $0.error.append(chunk) }
        }
        process.terminationHandler = { [store] finished in
            outputPipe.fileHandleForReading.readabilityHandler = nil
            errorPipe.fileHandleForReading.readabilityHandler = nil
            let rest = (try? outputPipe.fileHandleForReading.readToEnd()) ?? Data()
            let restError = (try? errorPipe.fileHandleForReading.readToEnd()) ?? Data()
            let (waiters, result) = store.state.withLock { state in
                state.output.append(rest)
                state.error.append(restError)
                state.status = finished.terminationStatus
                defer { state.waiters = [] }
                return (state.waiters, state.result)
            }
            for waiter in waiters { waiter.resume(returning: result) }
        }
        try process.run()
        let input = inputPipe.fileHandleForWriting
        try input.write(contentsOf: Data(stdin.utf8))
        try input.close()
    }

    public var isRunning: Bool { process.isRunning }

    public func terminate() { process.terminate() }

    public func result() async -> ProcessResult {
        await withCheckedContinuation { continuation in
            let ready = store.state.withLock { state -> ProcessResult? in
                guard state.status != nil else {
                    state.waiters.append(continuation)
                    return nil
                }
                return state.result
            }
            if let ready { continuation.resume(returning: ready) }
        }
    }

    /// Runs `/usr/bin/env <command> <arguments>` to completion.
    public static func run(_ command: String, _ arguments: [String], stdin: String = "", environment: [String: String] = [:]) async throws -> ProcessResult {
        try await RunningProcess(executable: "/usr/bin/env", arguments: [command] + arguments, stdin: stdin, environment: environment).result()
    }
}
