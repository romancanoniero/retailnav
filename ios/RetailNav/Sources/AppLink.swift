import Foundation

enum AppLink {
    static let webRoot = URL(string: "https://improvingyourreality.com/retailnav/")!
    private static let mallIDs: Set<String> = [
        "aventura", "ap-plaza", "new-world-city-shanghai"
    ]

    static func destination(for invocation: URL?) -> URL {
        var result = webRoot
        guard let invocation,
              invocation.scheme?.lowercased() == "https",
              invocation.host?.lowercased() == "improvingyourreality.com",
              invocation.user == nil,
              invocation.password == nil,
              invocation.path == "/retailnav/" || invocation.path == "/retailnav" else {
            return result
        }
        let query = URLComponents(url: invocation, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let mall = query.first(where: { $0.name == "mall" })?.value,
           mallIDs.contains(mall) {
            var components = URLComponents(url: result, resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "mall", value: mall)]
            result = components.url!
        }
        return result
    }

    static func isRetailNavNavigation(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" &&
        url.host?.lowercased() == "improvingyourreality.com" &&
        url.path.hasPrefix("/retailnav/")
    }
}
