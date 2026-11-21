import FardeskStore
import SwiftUI

/// A message the user just sent, in the feed before the machine confirmed it, with its state in place.
struct PendingMessageRow: View {
    @Environment(AppModel.self) private var model
    let message: PendingMessage

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            HStack {
                Spacer(minLength: 48)
                Text(message.text)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.secondary.opacity(0.12), in: .rect(cornerRadius: 20))
                    .opacity(message.canRetry ? 0.6 : 1)
            }
            if !message.message.attachments.isEmpty {
                PendingAttachmentsView(message: message).opacity(message.canRetry ? 0.6 : 1)
            }
            if let mark = message.deliveryMark {
                DeliveryMarkView(mark: mark)
            } else {
                stateLine
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .contain)
        // The container speaks the whole state in words (its children stay reachable for Retry): "offline probe. Queued - waiting for Linux".
        .accessibilityLabel("\(message.text). \(message.statusLabel)")
        .accessibilityIdentifier("pending-message")
        .onAppear { TapClock.finish("send.pending", model: model) }
    }

    private var stateLine: some View {
        HStack(spacing: 6) {
            if message.isInFlight {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: message.symbolName).font(.callout).foregroundStyle(stateColor)
            }
            Text(message.statusLabel).font(.callout).foregroundStyle(stateColor)
            if message.canRetry {
                Button("Retry") { model.retry(message.id) }.buttonStyle(.fardeskSecondary).accessibilityIdentifier("retry-button")
                Button("Discard") { model.discard(message.id) }.buttonStyle(.plain).font(.callout)
            }
        }
    }

    private var stateColor: Color { StateColor.color(StateTone(outbox: message.state)) }
}
