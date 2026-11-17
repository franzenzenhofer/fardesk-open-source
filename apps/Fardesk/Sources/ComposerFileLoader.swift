import FardeskStore
import Foundation
import UniformTypeIdentifiers

/// Reads the files chosen in the system file picker. Each file is opened with security-scoped access
/// and read whole; a file over 20 MB or an unreadable one is reported by name, never dropped silently.
enum ComposerFileLoader {
    struct Outcome {
        var files: [ComposerFile] = []
        var errors: [String] = []
    }

    static func load(_ urls: [URL], limit: Int) -> Outcome {
        var outcome = Outcome()
        for url in urls {
            guard outcome.files.count < limit else {
                outcome.errors.append("Only \(ComposerFileRules.maxAttachments) attachments fit in one message.")
                break
            }
            switch read(url) {
            case .success(let file): outcome.files.append(file)
            case .failure(let error): outcome.errors.append(error.message)
            }
        }
        return outcome
    }

    struct LoadError: Error { let message: String }

    private static func read(_ url: URL) -> Result<ComposerFile, LoadError> {
        let name = url.lastPathComponent
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
        if let size = values?.fileSize, !ComposerFileRules.fits(byteCount: size) {
            return .failure(LoadError(message: ComposerFileRules.tooLargeMessage(name: name, byteCount: size)))
        }
        guard let data = try? Data(contentsOf: url) else {
            return .failure(LoadError(message: "\(name) could not be read."))
        }
        guard ComposerFileRules.fits(byteCount: data.count) else {
            return .failure(LoadError(message: ComposerFileRules.tooLargeMessage(name: name, byteCount: data.count)))
        }
        let type = values?.contentType ?? UTType(filenameExtension: url.pathExtension)
        let mediaType = ComposerFileRules.mediaType(preferred: type?.preferredMIMEType)
        return .success(ComposerFile(data: data, name: name, mediaType: mediaType))
    }
}
