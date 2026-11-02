import ActivityKit
import WidgetKit
import SwiftUI

// "Watching now" on the lock screen and in the Dynamic Island: what you're in the middle of,
// how far through, and how long since you picked it up.

struct NowLockView: View {
    let attrs: NowAttributes
    let state: NowAttributes.ContentState
    var started: Date { Date(timeIntervalSince1970: attrs.started / 1000) }

    var body: some View {
        HStack(spacing: 14) {
            YouFace().frame(width: 46, height: 46)
            VStack(alignment: .leading, spacing: 4) {
                Text(attrs.verb.uppercased()).font(.system(size: 11, weight: .bold)).foregroundColor(Look.mute)
                Text(attrs.title).font(.system(size: 17, weight: .heavy)).foregroundColor(Look.ink).lineLimit(1)
                if state.progress >= 0 {
                    ProgressView(value: min(1, max(0, state.progress))).tint(Color(hex: attrs.colour))
                }
                HStack {
                    if !state.detail.isEmpty { Text(state.detail) }
                    Spacer()
                    Text(timerInterval: started...Date.distantFuture, countsDown: false).monospacedDigit()
                        .multilineTextAlignment(.trailing).frame(maxWidth: 80, alignment: .trailing)
                }
                .font(.system(size: 12, weight: .semibold)).foregroundColor(Look.mute)
            }
        }
        .padding(16)
    }
}

struct NowLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NowAttributes.self) { ctx in
            NowLockView(attrs: ctx.attributes, state: ctx.state)
                .activityBackgroundTint(Look.ground)
                .activitySystemActionForegroundColor(Look.ink)
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    YouFace().frame(width: 36, height: 36).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ctx.attributes.verb).font(.system(size: 11, weight: .bold)).foregroundColor(Look.mute)
                        Text(ctx.attributes.title).font(.system(size: 16, weight: .heavy)).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if !ctx.state.detail.isEmpty {
                        Text(ctx.state.detail).font(.system(size: 12, weight: .semibold)).foregroundColor(Look.mute).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if ctx.state.progress >= 0 {
                        ProgressView(value: min(1, max(0, ctx.state.progress))).tint(Color(hex: ctx.attributes.colour))
                    }
                }
            } compactLeading: {
                YouFace().frame(width: 20, height: 20)
            } compactTrailing: {
                if ctx.state.progress >= 0 {
                    Text("\(Int((ctx.state.progress * 100).rounded()))%").font(.system(size: 12, weight: .bold)).monospacedDigit()
                } else {
                    Text(timerInterval: Date(timeIntervalSince1970: ctx.attributes.started / 1000)...Date.distantFuture, countsDown: false)
                        .monospacedDigit().font(.system(size: 12, weight: .bold)).frame(maxWidth: 46)
                }
            } minimal: {
                YouFace().frame(width: 18, height: 18)
            }
            .keylineTint(Color(hex: ctx.attributes.colour))
        }
    }
}
