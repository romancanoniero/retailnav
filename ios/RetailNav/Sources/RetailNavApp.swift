import SwiftUI

@main
struct RetailNavApp: App {
    @State private var invocationURL: URL?

    var body: some Scene {
        WindowGroup {
            VisitorEntryView(invocationURL: $invocationURL)
                .onOpenURL { invocationURL = $0 }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    invocationURL = activity.webpageURL
                }
        }
    }
}
