import FardeskStore
import SwiftUI

/// Settings > Appearance.
struct AppearanceSettings: View {
    @AppStorage(ColourCoding.key) private var automaticColours = ColourCoding.defaultValue

    var body: some View {
        List {
            Section {
                Toggle("Automatic colours", isOn: $automaticColours).accessibilityIdentifier("settings-automatic-colours")
            } footer: {
                SettingsFooter("Gives every chat its own colour. Colours you pick yourself always stay.")
            }
        }
        .navigationTitle("Appearance")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

/// Settings > Voice.
struct VoiceSettingsView: View {
    var body: some View {
        List {
            Section {
                ReadAloudRow()
                VoiceAttachRow()
            } footer: {
                SettingsFooter("Read replies aloud speaks new answers. Attaching the recording sends your voice message along with its text.")
            }
        }
        .navigationTitle("Voice")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

/// Settings > Security: Face ID, and the devices signed in on each machine.
struct SecuritySettings: View {
    @AppStorage(AppServices.requireFaceIDKey) private var requiresFaceID = false

    var body: some View {
        List {
            Section {
                Toggle("Require Face ID", isOn: $requiresFaceID)
            } footer: {
                SettingsFooter("Ask for Face ID every time Fardesk opens.")
            }
            DevicesSection().disabledInDemo(.devices)
        }
        .navigationTitle("Security")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

/// Settings > About: the app version, each machine's daemon version, and where the source code is.
struct AboutSettings: View {
    private static let sourceURL = URL(string: "https://github.com/franzenzenhofer/fardesk-open-source")

    @Environment(AppModel.self) private var model

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    var body: some View {
        List {
            Section {
                LabeledContent("Fardesk", value: version)
                ForEach(model.state.machines) { machine in
                    if let info = machine.machine {
                        LabeledContent("Daemon on \(machine.endpoint.name)", value: info.version)
                    }
                }
            }
            if let url = Self.sourceURL {
                Section {
                    Link("github.com/franzenzenhofer/fardesk-open-source", destination: url)
                        .foregroundStyle(.primary)
                        .underline()
                } header: {
                    Text("Open source")
                }
            }
        }
        .navigationTitle("About")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
