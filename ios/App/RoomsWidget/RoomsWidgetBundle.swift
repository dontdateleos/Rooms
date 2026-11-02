import WidgetKit
import SwiftUI

@main
struct RoomsWidgetBundle: WidgetBundle {
    var body: some Widget {
        RoomWidget()
        NowLiveActivity()
    }
}
