import CoreGraphics
import FardeskStore
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// One chat image as it is stored: the chat plus the content hash the daemon reports in the label. A new image
/// has a new hash, so a key never needs invalidating.
struct ChatImageKey: Hashable, Sendable {
    let ref: SessionRef
    let hash: String

    fileprivate var prefix: String { "\(ref.machineID.uuidString)-\(ref.sessionID)-" }
    fileprivate var fileName: String { prefix + hash + ".jpg" }
}

/// The list's chat images: a memory cache rows read synchronously, a disk cache of 192 px square JPEGs in the
/// Caches folder, and one fetch per hash. Decoding and downscaling run off the main thread.
final class ChatImageCache: @unchecked Sendable {
    static let shared = ChatImageCache(folder: URL.cachesDirectory.appending(path: "ChatImages", directoryHint: .isDirectory))
    /// A fetch that failed is tried again only after this long, so a row that scrolls in and out does not hammer a machine.
    static let retryAfter: TimeInterval = 60

    private let folder: URL
    private let memory = NSCache<NSString, CGImage>()
    private let lock = NSLock()
    private var inFlight: [ChatImageKey: Task<CGImage?, Never>] = [:]
    private var failedAt: [ChatImageKey: Date] = [:]

    init(folder: URL) { self.folder = folder }

    /// The image when it is already in memory; rows draw this on their first frame.
    func cached(_ key: ChatImageKey) -> CGImage? { memory.object(forKey: key.fileName as NSString) }

    /// Memory, then disk, then one fetch through `fetch` (the model). nil when the chat has no image to show.
    func image(for key: ChatImageKey, fetch: @escaping @Sendable () async -> Data?) async -> CGImage? {
        if let hit = cached(key) { return hit }
        let task = lock.withLock { () -> Task<CGImage?, Never>? in
            if let running = inFlight[key] { return running }
            if let failed = failedAt[key], Date().timeIntervalSince(failed) < Self.retryAfter { return nil }
            let started = Task.detached(priority: .utility) { [self] in await resolve(key, fetch: fetch) }
            inFlight[key] = started
            return started
        }
        return await task?.value
    }

    private func resolve(_ key: ChatImageKey, fetch: @Sendable () async -> Data?) async -> CGImage? {
        var found = readDisk(key)
        if found == nil, let download = await fetch() { found = store(download, for: key) }
        lock.withLock {
            inFlight[key] = nil
            failedAt[key] = found == nil ? Date() : nil
        }
        if let found { memory.setObject(found, forKey: key.fileName as NSString) }
        return found
    }

    private func readDisk(_ key: ChatImageKey) -> CGImage? {
        let url = folder.appending(path: key.fileName)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    }

    /// Downscales the fetched bytes, keeps the JPEG on disk and drops this chat's older images.
    private func store(_ download: Data, for key: ChatImageKey) -> CGImage? {
        guard let square = ChatImageCodec.square(from: download),
            let jpeg = ChatImageCodec.jpeg(square, quality: ChatImageCodec.cacheQuality)
        else { return nil }
        let files = FileManager.default
        try? files.createDirectory(at: folder, withIntermediateDirectories: true)
        let older = (try? files.contentsOfDirectory(atPath: folder.path)) ?? []
        for name in older where name.hasPrefix(key.prefix) { try? files.removeItem(at: folder.appending(path: name)) }
        try? jpeg.write(to: folder.appending(path: key.fileName), options: .atomic)
        return square
    }
}
