import SwiftUI

/// Images from the server need the bearer token, which AsyncImage can't send.
struct RemoteImage<Placeholder: View>: View {
    let path: String?
    let api: APIClient?
    @ViewBuilder let placeholder: () -> Placeholder
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                placeholder()
            }
        }
        .task(id: path) {
            guard let path, let api else { return }
            if let cached = ImageCache.shared.object(forKey: path as NSString) {
                image = cached
                return
            }
            if let data = try? await api.loadImageData(path), let loaded = UIImage(data: data) {
                ImageCache.shared.setObject(loaded, forKey: path as NSString)
                image = loaded
            }
        }
    }
}

enum ImageCache {
    static let shared: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 300
        return cache
    }()
}

struct Avatar: View {
    @Environment(AppModel.self) private var model
    let user: UserSummary
    let size: CGFloat

    var body: some View {
        RemoteImage(path: user.avatarUrl, api: model.api) {
            Circle().fill(Self.colour(for: user.id))
                .overlay(Text(initials).font(.system(size: size * 0.38, weight: .semibold)).foregroundStyle(.white))
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    /// Discord-style default avatar colours, picked from the user's id so each person keeps theirs.
    static func colour(for id: String) -> Color {
        let palette = ["5865F2", "757E8A", "3BA55C", "FAA61A", "ED4245", "EB459F"]
        let sum = id.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
        return Color(hex: palette[sum % palette.count])!
    }

    private var initials: String {
        user.displayName.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
}
