import XCTest
@testable import RetailNavClip

final class AppLinkTests: XCTestCase {
    func testAcceptsAventuraQRAndDropsUnneededQueryData() {
        let input = URL(string: "https://improvingyourreality.com/retailnav/?mall=aventura&name=private#fragment")!
        XCTAssertEqual(AppLink.destination(for: input).absoluteString,
                       "https://improvingyourreality.com/retailnav/?mall=aventura")
    }

    func testAcceptsOtherCatalogMall() {
        let input = URL(string: "https://improvingyourreality.com/retailnav?mall=ap-plaza")!
        XCTAssertEqual(URLComponents(url: AppLink.destination(for: input), resolvingAgainstBaseURL: false)?.queryItems?.first?.value,
                       "ap-plaza")
    }

    func testRejectsUntrustedDomainsAndMallIDs() {
        XCTAssertEqual(AppLink.destination(for: URL(string: "https://evil.example/retailnav/?mall=aventura")!), AppLink.webRoot)
        XCTAssertEqual(AppLink.destination(for: URL(string: "https://improvingyourreality.com/retailnav/?mall=unknown")!), AppLink.webRoot)
        XCTAssertEqual(AppLink.destination(for: URL(string: "https://user@improvingyourreality.com/retailnav/?mall=aventura")!), AppLink.webRoot)
    }
}
