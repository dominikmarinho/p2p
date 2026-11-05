import SwiftUI
import WebKit
import Network

@MainActor final class PlayerModel: ObservableObject {
    @Published var message: String?
    @Published var loading = true
    @Published var online = true
    weak var webView: WKWebView?
    private let monitor = NWPathMonitor()
    private var closed = false
    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            Task { @MainActor in
                guard let self, !self.closed else { return }
                let recovered = !self.online && connected
                self.online = connected
                if recovered && self.message != nil { self.reload() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "highpass.network"))
    }
    func reload() { guard online else { message = "Sem conexão. Aguardando a rede voltar."; return }; message = nil; loading = true; webView?.reload() }
    func stop() { closed = true; monitor.cancel(); webView?.stopLoading() }
    deinit { monitor.cancel() }
}

struct PlayerScreen: View {
    let configuration: PlayerConfiguration
    @StateObject private var model = PlayerModel()
    @Environment(\.openURL) private var openURL
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(configuration.title).font(.headline).foregroundStyle(Color(red: 0.4, green: 0.89, blue: 0.7))
                Spacer()
                Button("Atualizações", systemImage: "arrow.down.circle") { openURL(configuration.downloadsURL) }.labelStyle(.iconOnly).accessibilityLabel("Verificar atualizações do aplicativo")
                Button("Recarregar", systemImage: "arrow.clockwise") { model.reload() }.labelStyle(.iconOnly)
            }.padding(.horizontal).padding(.vertical, 10)
            if !model.online { Text("Sem conexão · a reprodução tentará retomar quando a rede voltar").font(.caption).padding(8) }
            if let message = model.message { HStack { Text(message).font(.caption); Button("Tentar novamente") { model.reload() } }.padding(10) }
            ZStack(alignment: .top) {
                PlayerWebView(configuration: configuration, model: model)
                if model.loading { ProgressView().padding(12).background(.ultraThinMaterial, in: Capsule()).padding(12).accessibilityLabel("Carregando player") }
            }
        }.background(Color(red: 0.04, green: 0.06, blue: 0.09))
    }
}

struct PlayerWebView: UIViewRepresentable {
    let configuration: PlayerConfiguration
    @ObservedObject var model: PlayerModel
    func makeCoordinator() -> Coordinator { Coordinator(configuration: configuration, model: model) }
    func makeUIView(context: Context) -> WKWebView {
        let preferences = WKWebViewConfiguration()
        preferences.allowsInlineMediaPlayback = true
        preferences.allowsAirPlayForMediaPlayback = configuration.transport == .http
        preferences.mediaTypesRequiringUserActionForPlayback = []
        preferences.websiteDataStore = .default()
        preferences.limitsNavigationsToAppBoundDomains = true
        preferences.preferences.javaScriptCanOpenWindowsAutomatically = false
        let webView = WKWebView(frame: .zero, configuration: preferences)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        model.webView = webView
        webView.load(URLRequest(url: configuration.playerURL))
        return webView
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) { coordinator.model.stop(); uiView.navigationDelegate = nil; uiView.uiDelegate = nil }
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let configuration: PlayerConfiguration
        let model: PlayerModel
        private var lastCrashRecovery = Date.distantPast
        init(configuration: PlayerConfiguration, model: PlayerModel) { self.configuration = configuration; self.model = model }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url, navigationAction.targetFrame?.isMainFrame != false else { decisionHandler(.cancel); return }
            decisionHandler(configuration.permitsNavigation(url) ? .allow : .cancel)
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { model.loading = false; model.message = nil }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
        private func failed(_ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            model.loading = false
            model.message = model.online ? "Não foi possível carregar o player. Tente novamente." : "Sem conexão. Aguardando a rede voltar."
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            model.loading = false
            model.message = "O player foi reiniciado pelo iOS. Selecione o conteúdo novamente."
            guard Date().timeIntervalSince(lastCrashRecovery) > 10 else { return }
            lastCrashRecovery = Date(); webView.reload()
        }
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
    }
}
