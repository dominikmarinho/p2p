package com.highpass.player

import android.annotation.SuppressLint
import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.CookieManager
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

@SuppressLint("SetJavaScriptEnabled")
class P2PBridge(activity: Activity, playback: JSONObject, authToken: String, private val enabled: Boolean, private val onStats: (String) -> Unit) {
    companion object { private val activeGeneration = AtomicLong() }
    private val generation = activeGeneration.incrementAndGet()
    val webView = WebView(activity)
    private val handler = Handler(Looper.getMainLooper())
    private val ready = CountDownLatch(1)
    private data class Request(val future: CompletableFuture<ByteArray?> = CompletableFuture(), val data: SegmentBuffer = SegmentBuffer())
    private val requests = ConcurrentHashMap<String, Request>()
    @Volatile private var closed = false
    private val httpBytes = AtomicLong()
    private val httpTicker = object : Runnable {
        override fun run() {
            if (closed) return
            val bytes = httpBytes.getAndSet(0)
            if (bytes > 0) webView.evaluateJavascript("window.HighpassBridge?.http($bytes)", null)
            handler.postDelayed(this, 1000)
        }
    }
    init {
        webView.settings.javaScriptEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.settings.domStorageEnabled = false
        webView.isFocusable = false
        webView.isFocusableInTouchMode = false
        webView.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val engine = Uri.parse(BuildConfig.ENGINE_URL)
                return request.url.scheme != engine.scheme || request.url.host != engine.host || request.url.port != engine.port
            }
        }
        webView.addJavascriptInterface(object {
            @JavascriptInterface fun ready() { handler.post { webView.evaluateJavascript("window.HighpassBridge.init($playback,$enabled)") { ready.countDown() } } }
            @JavascriptInterface fun complete(id: String, chunk: String, done: Boolean) {
                val request = requests[id] ?: return
                try {
                    val bytes = Base64.decode(chunk, Base64.NO_WRAP)
                    if (request.future.isDone) return
                    request.data.append(bytes)
                    if (done) request.future.complete(request.data.bytes())
                } catch (_: Exception) { request.future.complete(null) }
            }
            @JavascriptInterface fun fallback(id: String) { requests[id]?.future?.complete(null) }
            @JavascriptInterface fun stats(json: String) { if (json.length <= 4096 && !closed) handler.post { if (!closed) onStats(json) } }
        }, "NativeSegments")
        val secure = if (BuildConfig.ENGINE_URL.startsWith("https://")) "; Secure" else ""
        CookieManager.getInstance().setCookie(BuildConfig.ENGINE_URL, "HP_SESSION=$authToken; HttpOnly; SameSite=Strict; Path=/api/iptv$secure") { webView.loadUrl(BuildConfig.ENGINE_URL + "/player/android-bridge.html") }
        handler.postDelayed(httpTicker, 1000)
    }
    fun load(uri: String, position: Long, length: Long): ByteArray? {
        if (!enabled || closed || Looper.myLooper() == Looper.getMainLooper() || !ready.await(750, TimeUnit.MILLISECONDS) || requests.size >= 4) return null
        val id = UUID.randomUUID().toString(); val request = Request(); requests[id] = request
        return try {
            handler.post { if (!closed) webView.evaluateJavascript("window.HighpassBridge.load(${JSONObject.quote(id)},${JSONObject.quote(uri)},$position,$length)", null) }
            request.future.get(14, TimeUnit.SECONDS)
        } catch (_: Exception) { null } finally { requests.remove(id) }
    }
    fun playlist(uri: String, text: String) {
        if (closed || text.length > 1024 * 1024 || !ready.await(750, TimeUnit.MILLISECONDS)) return
        val done = CountDownLatch(1)
        handler.post { if (!closed) webView.evaluateJavascript("window.HighpassBridge.playlist(${JSONObject.quote(uri)},${JSONObject.quote(text)})") { done.countDown() } else done.countDown() }
        done.await(2, TimeUnit.SECONDS)
    }
    fun http(bytes: Int) { if (!closed && bytes > 0) httpBytes.addAndGet(bytes.toLong()) }
    fun close() {
        closed = true; ready.countDown(); requests.values.forEach { it.future.complete(null) }; requests.clear()
        handler.removeCallbacks(httpTicker)
        webView.evaluateJavascript("window.HighpassBridge?.destroy()", null); webView.removeJavascriptInterface("NativeSegments"); webView.stopLoading(); webView.destroy()
        if (activeGeneration.get() == generation) CookieManager.getInstance().removeSessionCookies(null)
    }
}
