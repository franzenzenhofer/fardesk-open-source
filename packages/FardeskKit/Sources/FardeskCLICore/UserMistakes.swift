import FardeskStore

extension Error {
    /// The user asked for something that does not exist or left something out (unknown session or machine,
    /// bad arguments, not logged in): a usage error, exit 64, said in one plain sentence.
    var isUserMistake: Bool {
        switch self {
        case let error as CLIError: if case .usage = error { true } else { false }
        case is ShortIDError, is MachineListError, is MachineAccessError: true
        default: false
        }
    }

    /// Errors the CLI words itself (no daemon error code behind them): printed as `error: <sentence>`.
    var isLocalSentence: Bool {
        isUserMistake || self is CLIError
    }
}
