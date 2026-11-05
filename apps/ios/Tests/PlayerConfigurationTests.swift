import XCTest
import WebKit
@testable import HighpassHTTP

final class PlayerConfigurationTests: XCTestCase {
    func testSeparateTransportsAndStrictNavigation() {
        for transport in [PlayerTransport.http, .p2p] {
            let configuration = PlayerConfiguration(transport: transport)
            XCTAssertTrue(configuration.permitsNavigation(configuration.playerURL))
            XCTAssertFalse(configuration.permitsNavigation(URL(string: "http://p2p.remoto.api.br/player/\(transport.rawValue)/")!))
            XCTAssertFalse(configuration.permitsNavigation(URL(string: "https://p2p.remoto.api.br.attacker.test/player/\(transport.rawValue)/")!))
            XCTAssertFalse(configuration.permitsNavigation(URL(string: "https://p2p.remoto.api.br/admin")!))
            let other = transport == .http ? "p2p" : "http"
            XCTAssertFalse(configuration.permitsNavigation(URL(string: "https://p2p.remoto.api.br/player/\(other)/")!))
        }
    }
    @MainActor func testWebKitExposesWebRTCAndManagedMediaSource() async throws {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = false
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
        let loaded = expectation(description: "WebKit loaded")
        let delegate = LoadDelegate { loaded.fulfill() }
        webView.navigationDelegate = delegate
        webView.loadHTMLString("<html><body><video playsinline disableRemotePlayback></video></body></html>", baseURL: URL(string: "https://p2p.remoto.api.br"))
        await fulfillment(of: [loaded], timeout: 15)
        let capabilities = try await webView.evaluateJavaScript("JSON.stringify({rtc:typeof RTCPeerConnection==='function',managed:typeof ManagedMediaSource==='function',video:!!document.querySelector('video')})") as? String
        XCTAssertNotNil(capabilities)
        let value = try JSONSerialization.jsonObject(with: Data(capabilities!.utf8)) as! [String: Bool]
        XCTAssertEqual(value["rtc"], true)
        XCTAssertEqual(value["managed"], true)
        XCTAssertEqual(value["video"], true)
        withExtendedLifetime(delegate) {}
    }
}
private final class LoadDelegate: NSObject, WKNavigationDelegate {
    let loaded: () -> Void
    init(_ loaded: @escaping () -> Void) { self.loaded = loaded }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded() }
}
