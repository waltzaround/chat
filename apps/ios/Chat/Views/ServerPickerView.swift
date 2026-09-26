import SwiftUI

/// First screen: a welcome, then which Chat server to use.
struct ServerPickerView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var checking = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                Spacer(minLength: 48)
                AppMark(size: 88)
                VStack(spacing: 8) {
                    Text("Welcome to Chat")
                        .font(.title.bold())
                        .foregroundStyle(Theme.heading)
                    Text("Chat runs on servers that communities host themselves. Enter the address of yours to get started.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                }
                VStack(spacing: 8) {
                    FieldLabel(text: "Server address")
                    TextField("", text: $address, prompt: Text("chat.example.com").foregroundStyle(Theme.faint))
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($focused)
                        .onSubmit(connect)
                        .filledField()
                    Text(error ?? "The address you use for Chat in your browser. Ask whoever invited you if you're not sure.")
                        .font(.caption)
                        .foregroundStyle(error == nil ? Theme.muted : Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button(action: connect) {
                    if checking { ProgressView().tint(.white) } else { Text("Continue") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(checking || address.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.chat.ignoresSafeArea())
    }

    private func connect() {
        error = nil
        checking = true
        Task {
            do {
                try await model.chooseServer(address)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't reach that server. Check the address and your connection."
            }
            checking = false
        }
    }
}
