import FardeskModels
import FardeskStore
import SwiftUI

/// One block of the feed: a grey bubble, plain prose, the steps teaser or a small line.
struct FeedRow: View, Equatable {
    let block: FeedBlock
    /// The row is a message sent from this app that Claude has read.
    var gotIt = false

    var body: some View {
        switch block {
        case .user(_, let text, let files):
            VStack(alignment: .trailing, spacing: 6) {
                if !text.isEmpty {
                    HStack {
                        Spacer(minLength: 48)
                        Text(text)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(.secondary.opacity(0.12), in: .rect(cornerRadius: 20))
                            .textSelection(.enabled)
                    }
                }
                if !files.isEmpty {
                    AttachedFilesView(files: files)
                }
                if gotIt {
                    DeliveryMarkView(mark: .gotIt)
                }
            }
        case .assistant(_, let text):
            MarkdownText(text: text).frame(maxWidth: .infinity, alignment: .leading)
        case .steps(_, let steps):
            StepsLine(steps: steps)
        case .note(_, let symbolName, let text):
            if let symbolName {
                Label(text, systemImage: symbolName).font(.subheadline).foregroundStyle(.secondary)
            } else {
                Text(text).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
            }
        }
    }
}

/// The teaser of the work between two messages: one small grey line, a spinner while a step runs.
private struct StepsLine: View {
    let steps: FeedSteps

    var body: some View {
        HStack(spacing: 8) {
            if steps.isRunning {
                ProgressView().controlSize(.mini)
            } else {
                Image(systemName: "ellipsis.circle").foregroundStyle(.tertiary)
            }
            Text(steps.text).lineLimit(1).truncationMode(.middle)
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }
}
