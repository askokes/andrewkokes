import SwiftUI
import UIKit
import WebKit

/// The food tracker web app, full screen. Signing in (Cloudflare Access's emailed code) happens inside
/// it and is remembered like in Safari. The page talks to the app on `window.webkit.messageHandlers.foodTracker`
/// (web/src/native.ts): status, connect, sync, disconnect, each answered with the sync status.
struct WebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "foodTracker")

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = AppConfig.background
        view.underPageBackgroundColor = AppConfig.background
        // The page lays itself out around the notch and home bar (viewport-fit=cover and env()).
        view.scrollView.contentInsetAdjustmentBehavior = .never

        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pulledToRefresh(_:)), for: .valueChanged)
        view.scrollView.refreshControl = refresh

        context.coordinator.webView = view
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
        weak var webView: WKWebView?

        @objc func pulledToRefresh(_ control: UIRefreshControl) {
            webView?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { control.endRefreshing() }
        }

        // MARK: Messages from the page

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
            // Only the food tracker itself may ask, never a sign-in page or anything else loaded here.
            guard message.frameInfo.securityOrigin.host == AppConfig.host,
                  let body = message.body as? [String: Any],
                  let type = body["type"] as? String
            else { return replyHandler(nil, "Not allowed.") }

            Task {
                let status: HealthSync.Status
                switch type {
                case "connect":
                    guard let key = body["key"] as? String, let syncUrl = body["syncUrl"] as? String,
                          URL(string: syncUrl)?.host == AppConfig.host
                    else { return await MainActor.run { replyHandler(nil, "Missing the sync key.") } }
                    status = await HealthSync.shared.connect(key: key, syncUrl: syncUrl)
                case "sync":
                    status = await HealthSync.shared.sync(force: true)
                case "disconnect":
                    status = await HealthSync.shared.disconnect()
                default:
                    status = await HealthSync.shared.status()
                }
                let reply = status.dictionary
                await MainActor.run { replyHandler(reply, nil) }
            }
        }

        // MARK: Navigation

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            let scheme = url.scheme?.lowercased() ?? ""
            // shortcuts:, mailto:, tel: and the like belong to other apps.
            if scheme != "http", scheme != "https", scheme != "about", scheme != "blob", scheme != "data" {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            // A tapped link to another site opens in Safari. Redirects (the sign-in) stay here.
            if action.navigationType == .linkActivated, let host = url.host, host != AppConfig.host {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        // MARK: Page UI: new windows, camera and mic, alert / confirm

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            // The barcode scanner and the mic. iOS still asks the person the first time.
            decisionHandler(origin.host == AppConfig.host ? .grant : .deny)
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            present(alert, from: webView, orElse: completionHandler)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            present(alert, from: webView) { completionHandler(false) }
        }

        private func present(_ alert: UIAlertController, from view: UIView, orElse fallback: @escaping () -> Void) {
            guard var top = view.window?.rootViewController else { return fallback() }
            while let next = top.presentedViewController { top = next }
            top.present(alert, animated: true)
        }
    }
}
