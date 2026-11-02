import Foundation
import UIKit
import Capacitor
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Capacitor's own screen, with this app's native bits registered on it.
class RoomsBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RoomsNativePlugin())
    }
}

/// The page talks to the widget and to Live Activities through this.
@objc(RoomsNativePlugin)
public class RoomsNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoomsNativePlugin"
    public let jsName = "RoomsNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endActivity", returnType: CAPPluginReturnPromise)
    ]

    /// the room's snapshot, as JSON, for the widget; the widget redraws straight away
    @objc func setWidget(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8) else {
            call.reject("nothing to show"); return
        }
        SharedStore.write(data)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    /// starts "Watching now" for a title, or updates the one already showing for it
    @objc func startActivity(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.resolve(["started": false]); return }
            let key = call.getString("key") ?? ""
            let state = NowAttributes.ContentState(detail: call.getString("detail") ?? "",
                                                   progress: call.getDouble("progress") ?? -1)
            let attrs = NowAttributes(key: key,
                                      title: call.getString("title") ?? "",
                                      verb: call.getString("verb") ?? "Watching",
                                      colour: call.getString("colour") ?? "#F7B3CF",
                                      started: call.getDouble("started") ?? Date().timeIntervalSince1970 * 1000)
            Task {
                if let running = Activity<NowAttributes>.activities.first(where: { $0.attributes.key == key }) {
                    await running.update(ActivityContent(state: state, staleDate: nil))
                    call.resolve(["started": true, "updated": true])
                    return
                }
                do {
                    _ = try Activity.request(attributes: attrs, content: ActivityContent(state: state, staleDate: nil), pushType: nil)
                    call.resolve(["started": true])
                } catch {
                    call.resolve(["started": false, "error": error.localizedDescription])
                }
            }
            return
        }
        #endif
        call.resolve(["started": false])
    }

    /// ends "Watching now" for one title, or every one when no key is given;
    /// keep: the keys that should stay (everything else ends)
    @objc func endActivity(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let key = call.getString("key")
            let keep = Set(call.getArray("keep", String.self) ?? [])
            Task {
                for a in Activity<NowAttributes>.activities {
                    let goes = key != nil ? a.attributes.key == key : !keep.contains(a.attributes.key)
                    if goes { await a.end(nil, dismissalPolicy: .immediate) }
                }
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }
}
