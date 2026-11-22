import FardeskStore
import SwiftUI

/// A chat's own image, filling its frame. It draws from memory on the first frame when it can; otherwise it draws
/// `placeholder` and swaps in the image once the cache has loaded it. Fetches go through the model, once per hash.
struct ChatImageView<Placeholder: View>: View {
    @Environment(AppModel.self) private var model
    let key: ChatImageKey
    @ViewBuilder let placeholder: () -> Placeholder
    @State private var loaded: CGImage?

    var body: some View {
        if let image = loaded ?? ChatImageCache.shared.cached(key) {
            Image(decorative: image, scale: 1)
                .resizable()
                .scaledToFill()
        } else {
            placeholder()
                .task(id: key) { await load() }
        }
    }

    private func load() async {
        let ref = key.ref
        let model = model
        loaded = await ChatImageCache.shared.image(for: key) { await model.imageData(ref) }
    }
}
