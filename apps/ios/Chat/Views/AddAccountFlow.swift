import SwiftUI

/// Server address, then sign in. The first screen on first launch, and the "Add a
/// server" sheet afterwards.
struct AddAccountFlow: View {
    var adding = false
    var onDone: () -> Void = {}
    @State private var path: [URL] = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack(path: $path) {
            ServerPickerView(adding: adding) { path.append($0) }
                .navigationDestination(for: URL.self) { server in
                    SignInView(server: server, onDone: onDone)
                }
                .toolbar {
                    if adding {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    }
                }
        }
    }
}
