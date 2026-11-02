import Foundation
import Security
#if canImport(ActivityKit)
import ActivityKit
#endif

// Shared by the app and its widget extension (the widget build adds this file to both).

/// The app hands the widget a small JSON snapshot of your room. It lives in a keychain item
/// both can read: a keychain access group under the team's own prefix needs no setup in the
/// developer portal, unlike an App Group.
enum SharedStore {
    static let group = "M6AXSFYX2W.com.touringgroup.rooms.shared"
    static let service = "com.touringgroup.rooms.widget"
    static let account = "room-snapshot"

    private static var base: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrAccessGroup as String: group]
    }

    static func write(_ data: Data) {
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        let status = SecItemUpdate(base as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = base
            for (k, v) in attrs { add[k] = v }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    static func read() -> Data? {
        var q = base
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }
}

/// What the widget shows: the room, its newest logs, and tonight's pick.
struct RoomSnapshot: Codable {
    struct Log: Codable {
        var who: String
        var title: String
        var kind: String
        var stars: Double
        var cover: String?
    }
    var room: String
    var colour: String
    var tonight: String?
    var tonightCover: String?
    var logs: [Log]
    var updated: Double
}

#if canImport(ActivityKit)
/// "Watching now" on the lock screen and in the Dynamic Island.
@available(iOS 16.1, *)
struct NowAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var detail: String      // "p. 310 of 496", "S2 E4", "40%", or ""
        var progress: Double    // 0...1, or -1 when there's nothing to measure
    }
    var key: String             // the work's id
    var title: String
    var verb: String            // Watching, Reading, Playing
    var colour: String          // the medium's colour, as hex
    var started: Double         // ms since 1970
}
#endif
