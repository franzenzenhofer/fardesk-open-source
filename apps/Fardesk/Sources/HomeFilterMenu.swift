import SwiftUI

/// A toolbar menu that narrows the session list to the sessions of one Claude home (account).
struct HomeFilterMenu: View {
    let choices: [String]
    @Binding var selection: String?

    var body: some View {
        Menu {
            Picker("Home", selection: $selection) {
                Text("All homes").tag(String?.none)
                ForEach(choices, id: \.self) { home in
                    Text(home).tag(Optional(home)).accessibilityIdentifier("home-filter-\(home)")
                }
            }
        } label: {
            ToolbarIcon(systemName: selection == nil ? "person.2" : "person.2.fill")
        }
        .accessibilityLabel(selection.map { "Home filter: \($0)" } ?? "Home filter")
        .accessibilityIdentifier("home-filter-menu")
    }
}
