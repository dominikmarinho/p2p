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
import java.net.URL
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

@SuppressLint("SetJavaScriptEnabled")
class P2PBridge(activity: Activity, playback: JSONObject, authToken: String, requestedEnabled: Boolean, private val onStats: (String) -> Unit) {
    companion object { private val activeGeneration = AtomicLong() }
    private val enabled = requestedEnabled || playback.optJSONObject("delivery")?.optString("mode") == "p2p-first"
    private val generation = activeGeneration.incrementAndGet()
    val webView = WebView(activity)
    private val handler = Handler(Looper.getMainLooper())
    private val ready = CountDownLatch(1)
    private data class Request(val future: CompletableFuture<ByteArray?> = CompletableFuture(), val data: SegmentBuffer = SegmentBuffer())
    private val requests = ConcurrentHashMap<String, Request>()
    @Volatile private var closed = false
    @Volatile private var initialized = false
    private val httpBytes = AtomicLong()
    private val directHttpTotal = AtomicLong()
    private val pendingPlaylists = LinkedHashMap<String, String>()
    private val segmentUris = ConcurrentHashMap.newKeySet<String>()
    private val httpTicker = object : Runnable {
        override fun run() {
            if (closed) return
            val bytes = httpBytes.getAndSet(0)
            if (bytes > 0) {
                if (initialized) webView.evaluateJavascript("window.HighpassBridge?.http($bytes)", null)
                else { val total = directHttpTotal.addAndGet(bytes); onStats(JSONObject().put("deliveryMode", "http").put("httpDownloaded", total).put("p2pDownloaded", 0).put("totalDownloaded", total).put("p2pPercentage", 0).put("peers", 0).put("downloadRate", 0).put("uploadRate", 0).toString()) }
            }
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
            @JavascriptInterface fun ready() { handler.post {
                if (closed) return@post
                webView.evaluateJavascript("(function(){try{window.HighpassBridge.init($playback,$enabled);return true}catch(error){return false}})()") { result ->
                    initialized = result == "true"
                    if (initialized) {
                        val earlyHttp = directHttpTotal.getAndSet(0)
                        if (earlyHttp > 0) webView.evaluateJavascript("window.HighpassBridge.http($earlyHttp)", null)
                        for ((uri, text) in pendingPlaylists) webView.evaluateJavascript("window.HighpassBridge.playlist(${JSONObject.quote(uri)},${JSONObject.quote(text)})", null)
                    }
                    pendingPlaylists.clear(); ready.countDown()
                }
            } }
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
        if (!enabled || closed || !segmentUris.contains(uri) || Looper.myLooper() == Looper.getMainLooper() || !ready.await(750, TimeUnit.MILLISECONDS) || requests.size >= 4) return null
        if (closed || !initialized) return null
        val id = UUID.randomUUID().toString(); val request = Request(); requests[id] = request
        if (closed) { requests.remove(id); return null }
        return try {
            handler.post { if (!closed) webView.evaluateJavascript("window.HighpassBridge.load(${JSONObject.quote(id)},${JSONObject.quote(uri)},$position,$length)", null) else request.future.complete(null) }
            request.future.get(14, TimeUnit.SECONDS)
        } catch (_: Exception) { null } finally { requests.remove(id) }
    }
    fun playlist(uri: String, text: String) {
        if (closed || text.length > 1024 * 1024) return
        var segment = false
        for (line in text.lineSequence().map { it.trim() }) {
            if (line.startsWith("#EXTINF:")) segment = true
            else if (segment && line.isNotEmpty() && !line.startsWith("#")) {
                runCatching { URL(URL(uri), line).toExternalForm() }.getOrNull()?.let { segmentUris.add(it) }
                segment = false
            }
        }
        // A native manifest is always HTTP. JS registration and the subsequent load
        // share the main-thread queue, so the loader need not block on every refresh.
        if (segmentUris.size > 2000) segmentUris.retainAll(text.lineSequence().filter { it.isNotBlank() && !it.startsWith("#") }.mapNotNull { runCatching { URL(URL(uri), it.trim()).toExternalForm() }.getOrNull() }.toSet())
        handler.post {
            if (closed) return@post
            if (ready.count > 0L) {
                pendingPlaylists[uri] = text
                while (pendingPlaylists.size > 8 || pendingPlaylists.values.sumOf { it.length } > 4 * 1024 * 1024) {
                    val victim = pendingPlaylists.entries.firstOrNull { !it.value.contains("#EXT-X-STREAM-INF:") } ?: pendingPlaylists.entries.first()
                    pendingPlaylists.remove(victim.key)
                }
            } else if (initialized) webView.evaluateJavascript("window.HighpassBridge.playlist(${JSONObject.quote(uri)},${JSONObject.quote(text)})", null)
        }
    }
    fun resume() { if (!closed) handler.post { webView.evaluateJavascript("window.HighpassBridge?.resume?.()", null) } }
    fun playhead(seconds: Double) { if (!closed && seconds.isFinite() && seconds >= 0) handler.post { if (ready.count == 0L) webView.evaluateJavascript("window.HighpassBridge?.playhead?.($seconds)", null) } }
    fun httpOnly() { if (!closed) handler.post { webView.evaluateJavascript("window.HighpassBridge?.httpOnly?.()", null) } }
    fun http(bytes: Int) { if (!closed && bytes > 0) httpBytes.addAndGet(bytes.toLong()) }
    fun close() {
        closed = true; pendingPlaylists.clear(); segmentUris.clear(); ready.countDown(); requests.values.forEach { it.future.complete(null) }; requests.clear()
        handler.removeCallbacks(httpTicker)
        webView.evaluateJavascript("window.HighpassBridge?.destroy()", null); webView.removeJavascriptInterface("NativeSegments"); webView.stopLoading(); webView.destroy()
        if (activeGeneration.get() == generation) CookieManager.getInstance().removeSessionCookies(null)
    }
}
