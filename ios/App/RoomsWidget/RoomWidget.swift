import WidgetKit
import SwiftUI

// "Your room" on the home screen and lock screen: the newest logs, and tonight's pick.

struct RoomEntry: TimelineEntry {
    let date: Date
    let snap: RoomSnapshot?
    let images: [String: UIImage]
}

extension RoomSnapshot {
    static let sample = RoomSnapshot(room: "The Pit", colour: "#F7B3CF", tonight: "Thief", tonightCover: nil,
        logs: [.init(who: "ali", title: "Past Lives", kind: "film", stars: 4.5, cover: nil),
               .init(who: "mo", title: "Disco Elysium", kind: "game", stars: 5, cover: nil),
               .init(who: "cass", title: "Outer Wilds", kind: "game", stars: 4.5, cover: nil)],
        updated: Date().timeIntervalSince1970 * 1000)
}

struct RoomProvider: TimelineProvider {
    func placeholder(in context: Context) -> RoomEntry { RoomEntry(date: Date(), snap: .sample, images: [:]) }

    func getSnapshot(in context: Context, completion: @escaping (RoomEntry) -> Void) {
        completion(RoomEntry(date: Date(), snap: load() ?? .sample, images: [:]))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RoomEntry>) -> Void) {
        let snap = load()
        Task {
            var images: [String: UIImage] = [:]
            let urls = ([snap?.tonightCover] + (snap?.logs.prefix(3).map { $0.cover } ?? [])).compactMap { $0 }
            for u in urls where images[u] == nil {
                if let im = await fetch(u) { images[u] = im }
            }
            let next = Date().addingTimeInterval(30 * 60)
            completion(Timeline(entries: [RoomEntry(date: Date(), snap: snap, images: images)], policy: .after(next)))
        }
    }

    private func load() -> RoomSnapshot? {
        guard let d = SharedStore.read() else { return nil }
        return try? JSONDecoder().decode(RoomSnapshot.self, from: d)
    }

    /// posters come down small, so the widget stays inside its memory budget
    private func fetch(_ s: String) async -> UIImage? {
        guard let url = URL(string: s), let (data, _) = try? await URLSession.shared.data(from: url),
              let im = UIImage(data: data), im.size.width > 0 else { return nil }
        let w: CGFloat = 180, h = w * im.size.height / im.size.width
        return UIGraphicsImageRenderer(size: CGSize(width: w, height: h)).image { _ in
            im.draw(in: CGRect(x: 0, y: 0, width: w, height: h))
        }
    }
}

struct Poster: View {
    let url: String?
    let kind: String
    let title: String
    let images: [String: UIImage]
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            if let u = url, let im = images[u] {
                Image(uiImage: im).resizable().aspectRatio(contentMode: .fill)
            } else {
                Look.kind(kind)
                Text(title).font(.system(size: 8, weight: .heavy)).foregroundColor(Color(hex: "#151320"))
                    .lineLimit(2).padding(4)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

struct RoomWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: RoomEntry

    var body: some View {
        Group {
            if let s = entry.snap {
                switch family {
                case .accessoryRectangular: lockView(s)
                case .systemMedium: mediumView(s)
                default: smallView(s)
                }
            } else {
                emptyView
            }
        }
        .widgetGround(Look.ground)
    }

    var emptyView: some View {
        VStack(alignment: .leading, spacing: 8) {
            YouFace().frame(width: 30, height: 30)
            Spacer(minLength: 0)
            Text("Open Rooms to see your room here").font(.system(size: 13, weight: .bold)).foregroundColor(Look.ink)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    func header(_ s: RoomSnapshot) -> some View {
        HStack(spacing: 6) {
            Circle().fill(Color(hex: s.colour)).frame(width: 7, height: 7)
            Text(s.room).font(.system(size: 12, weight: .heavy)).foregroundColor(Look.ink).lineLimit(1)
        }
    }

    func smallView(_ s: RoomSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            header(s)
            if let l = s.logs.first {
                HStack(alignment: .top, spacing: 8) {
                    Poster(url: l.cover, kind: l.kind, title: l.title, images: entry.images).frame(width: 40, height: 60)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.who).font(.system(size: 11, weight: .bold)).foregroundColor(Look.mute).lineLimit(1)
                        Text(l.title).font(.system(size: 13, weight: .heavy)).foregroundColor(Look.ink).lineLimit(2)
                        Text(starText(l.stars)).font(.system(size: 10)).foregroundColor(Color(hex: "#FFE36B"))
                    }
                }
            }
            Spacer(minLength: 0)
            if let t = s.tonight {
                Text("Tonight · \(t)").font(.system(size: 11, weight: .semibold)).foregroundColor(Look.mute).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    func mediumView(_ s: RoomSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                header(s)
                Spacer()
                if let t = s.tonight {
                    Text("Tonight · \(t)").font(.system(size: 11, weight: .semibold)).foregroundColor(Look.mute).lineLimit(1)
                }
            }
            HStack(alignment: .top, spacing: 10) {
                ForEach(Array(s.logs.prefix(3).enumerated()), id: \.offset) { _, l in
                    VStack(alignment: .leading, spacing: 3) {
                        Poster(url: l.cover, kind: l.kind, title: l.title, images: entry.images).frame(height: 70)
                        Text(l.who).font(.system(size: 10, weight: .bold)).foregroundColor(Look.mute).lineLimit(1)
                        Text(l.title).font(.system(size: 11, weight: .heavy)).foregroundColor(Look.ink).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    func lockView(_ s: RoomSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(s.room).font(.system(size: 12, weight: .heavy)).lineLimit(1)
            if let l = s.logs.first {
                Text("\(l.who) · \(l.title)").font(.system(size: 12)).lineLimit(1)
            }
            if let t = s.tonight { Text("Tonight · \(t)").font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct RoomWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RoomWidget", provider: RoomProvider()) { entry in
            RoomWidgetView(entry: entry)
        }
        .configurationDisplayName("Your room")
        .description("What your room just logged, and tonight's pick.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}
