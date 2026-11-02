import SwiftUI
import WidgetKit

// The app's own colours and the little pink face from the logo, for the widget and the
// lock screen.
enum Look {
    static let ground = Color(hex: "#16131C")
    static let card = Color(hex: "#1D1A25")
    static let ink = Color(hex: "#F4EDE2")
    static let mute = Color(hex: "#A099B4")
    static let pink = Color(hex: "#F7B3CF")
    static func kind(_ k: String) -> Color {
        switch k {
        case "film": return Color(hex: "#FFB36B")
        case "tv": return Color(hex: "#F5A3C7")
        case "book": return Color(hex: "#FFE86A")
        case "game": return Color(hex: "#9EF0C9")
        default: return Color(hex: "#B9A6FF")
        }
    }
}

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        let r, g, b: Double
        if h.count == 6 { r = Double((v >> 16) & 0xFF) / 255; g = Double((v >> 8) & 0xFF) / 255; b = Double(v & 0xFF) / 255 }
        else { r = 0.97; g = 0.70; b = 0.81 }
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }
}

/// your room from the logo: pink, lit from the top left, two eyes
struct YouFace: View {
    var body: some View {
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            ZStack(alignment: .topLeading) {
                Color(hex: "#C68FA6")
                Look.pink
                    .frame(width: s * 0.8, height: s)
                    .clipShape(RoundedRectangle(cornerRadius: s * 0.4, style: .continuous))
                Color(hex: "#FBD2E3").frame(width: s, height: s * 0.3)
                Capsule().fill(Color(hex: "#151320"))
                    .frame(width: s * 0.14, height: s * 0.32)
                    .offset(x: s * 0.18, y: s * 0.425)
                Capsule().fill(Color(hex: "#151320"))
                    .frame(width: s * 0.14, height: s * 0.32)
                    .offset(x: s * 0.455, y: s * 0.433)
            }
            .frame(width: s, height: s)
            .clipShape(RoundedRectangle(cornerRadius: s * 0.4, style: .continuous))
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

extension View {
    /// iOS 17 wants the widget's background declared; older systems just paint it
    @ViewBuilder func widgetGround(_ c: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) { self.containerBackground(c, for: .widget) }
        else { self.background(c) }
    }
}

func starText(_ stars: Double) -> String {
    let full = Int(stars.rounded(.down)), half = stars - Double(full) >= 0.5
    return String(repeating: "★", count: full) + (half ? "½" : "")
}
