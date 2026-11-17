import FardeskStore
import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @State private var password = ""
    @State private var showsPairing = false
    @FocusState private var passwordFocused: Bool

    private var isLoggingIn: Bool { model.phase == .loggingIn }

    var body: some View {
        LoginForm(
            password: $password,
            focused: $passwordFocused,
            isLoggingIn: isLoggingIn,
            error: model.loginError,
            logIn: logIn,
            usePairing: { showsPairing = true },
            target: model.isHubMode ? "the hub (\(model.hubDisplayName), \(model.hubAddress))" : nil
        )
        .sheet(isPresented: $showsPairing) { PairingSheet() }
        .task { passwordFocused = true }
    }

    private func logIn() {
        guard !password.isEmpty, !isLoggingIn else { return }
        let entered = password
        password = ""
        Task { await model.login(password: entered) }
    }
}

/// App symbol, name, one password field and a prominent Log In button, centred.
struct LoginForm: View {
    @Binding var password: String
    var focused: FocusState<Bool>.Binding
    let isLoggingIn: Bool
    let error: String?
    let logIn: () -> Void
    let usePairing: () -> Void
    var target: String?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            VStack(spacing: 12) {
                Image("AppLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 96, height: 96)
                    .accessibilityHidden(true)
                Text("Fardesk").font(.largeTitle.bold())
                if let target { Text("Log in to \(target)").font(.body).foregroundStyle(.secondary) }
            }
            VStack(spacing: 12) {
                SecureField("Password", text: $password)
                    #if os(iOS)
                    .textContentType(.password)
                    #endif
                    .focused(focused)
                    .submitLabel(.go)
                    .onSubmit(logIn)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.large)
                if let error {
                    Text(error).font(.footnote).foregroundStyle(StateColor.broken).multilineTextAlignment(.center)
                }
                Button(action: logIn) {
                    HStack {
                        if isLoggingIn { ProgressView() }
                        Text("Log In")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.fardeskPrimary)
                .disabled(password.isEmpty || isLoggingIn)
                Button("Use pairing link", action: usePairing).font(.subheadline)
            }
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
