import SwiftUI
import WebKit
import UIKit

struct VisitorEntryView: View {
    @Binding var invocationURL: URL?
    @State private var visitorName = ""
    @State private var enteredMap = false
    @FocusState private var nameFieldFocused: Bool

    private var mapURL: URL { AppLink.destination(for: invocationURL) }

    var body: some View {
        Group {
            if enteredMap {
                RetailNavWebView(url: mapURL, visitorName: visitorName.trimmingCharacters(in: .whitespacesAndNewlines))
                    .ignoresSafeArea()
            } else {
                VStack(alignment: .leading, spacing: 24) {
                    Spacer()
                    Text("RetailNav")
                        .font(.largeTitle.bold())
                    Text("¿Cómo te llamamos?")
                        .font(.title2.weight(.semibold))
                    TextField("Tu nombre", text: $visitorName)
                        .textContentType(.nickname)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($nameFieldFocused)
                        .padding(16)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
                        .onSubmit(enterMap)
                    Button(action: enterMap) {
                        Text("Abrir el mapa")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(17)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(visitorName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Spacer()
                    Text("Tu nombre ayuda a identificarte si compartís tu ubicación con otras personas.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(24)
                .background(Color(uiColor: .systemBackground))
                .onAppear { nameFieldFocused = true }
            }
        }
        .preferredColorScheme(.light)
    }

    private func enterMap() {
        guard !visitorName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        nameFieldFocused = false
        enteredMap = true
    }
}

private struct RetailNavWebView: UIViewRepresentable {
    let url: URL
    let visitorName: String

    func makeCoordinator() -> Coordinator { Coordinator(visitorName: visitorName) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.96, green: 0.95, blue: 0.92, alpha: 1)
        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.visitorName = visitorName
        if webView.url == nil { webView.load(URLRequest(url: url, timeoutInterval: 30)) }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var visitorName: String
        private var profileWasSent = false

        init(visitorName: String) { self.visitorName = visitorName }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !profileWasSent else { return }
            let payload: [String: String] = ["name": visitorName]
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('retailnav:appclip-profile',{detail:\(json)}));") { _, error in
                if error == nil { self.profileWasSent = true }
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(AppLink.isRetailNavNavigation(url) ? .allow : .cancel)
        }
    }
}
