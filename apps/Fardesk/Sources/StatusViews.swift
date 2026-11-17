import FardeskStore
import SwiftUI

/// The first line of the Machines screen while the hub is connecting or does not answer.
struct HubStatusRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let status = model.hubStatus, let text = model.hubBannerText {
            HStack(spacing: 12) {
                if status.showsSpinner {
                    ProgressView()
                } else {
                    Image(systemName: "wifi.exclamationmark").foregroundStyle(StateColor.color(StateTone(hub: status)))
                }
                Text(text).font(.body)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("hub-status")
        }
    }
}

/// The latest action of one place, in that place: a line in a session's feed or at the top of the list. A
/// spinner while it runs, then a check or a red cross; a failure stays until "Dismiss".
struct NoticeRow: View {
    @Environment(AppModel.self) private var model
    let scope: NoticeScope

    var body: some View {
        if let notice = model.notices[scope] {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Group {
                    switch notice.state {
                    case .running: ProgressView().controlSize(.small)
                    case .succeeded: Image(systemName: "checkmark.circle.fill")
                    case .failed: Image(systemName: "xmark.circle.fill")
                    case .info: Image(systemName: "info.circle")
                    }
                }
                .foregroundStyle(StateColor.color(StateTone(notice: notice.state)))
                Text(notice.text).font(.subheadline).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if notice.state == .failed {
                    Button("Dismiss") { model.dismissNotice(in: scope) }
                        .font(.subheadline)
                        .buttonStyle(.borderless)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("notice-row")
        }
    }
}

/// What is happening for a session, step by step.
struct StepLogView: View {
    let log: StepLog

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(log.steps) { step in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    if let symbol = step.symbolName {
                        Image(systemName: symbol).foregroundStyle(StateColor.color(StateTone(step: step.state)))
                    } else {
                        ProgressView().controlSize(.small)
                    }
                    Text(step.displayText).font(.body).foregroundStyle(step.symbolName == nil ? .primary : .secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.secondary.opacity(0.1), in: .rect(cornerRadius: 16))
        .accessibilityIdentifier("step-log")
    }
}

/// The screen of a session that is being started: it opens at once and shows the steps.
struct StartingSessionView: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    let ref: SessionRef

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            StepLogView(log: model.stepLogs[ref] ?? StepLog()).padding(.horizontal)
            if model.stepLogs[ref]?.hasFailure == true {
                Button("Close") { coordinator.selection = nil }.buttonStyle(.fardeskSecondary)
            }
            Spacer()
        }
        .navigationTitle("New Session")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onChange(of: model.startedSessions[ref]) { _, started in open(started) }
        .task { open(model.startedSessions[ref]) }
    }

    private func open(_ started: SessionRef?) {
        guard let started else { return }
        coordinator.selection = started
    }
}
