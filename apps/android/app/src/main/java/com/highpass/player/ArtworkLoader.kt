package com.highpass.player

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import android.widget.ImageView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

class ArtworkLoader(private val scope: CoroutineScope, private val token: String) {
    private val slots = Semaphore(4)
    private val cache = object : LruCache<String, Bitmap>(16 * 1024 * 1024) { override fun sizeOf(key: String, value: Bitmap) = value.byteCount }
    fun clear() = cache.evictAll()
    fun load(view: ImageView, item: JSONObject) {
        val raw = item.optString("image"); view.setImageDrawable(null); view.tag = raw
        if (raw.isBlank()) return
        val kind = item.optString("artworkKind", item.optString("kind", "live")); val id = item.optString("artworkId", item.optString("id"))
        val target = if (raw.startsWith("https://")) raw else "${BuildConfig.ENGINE_URL}/api/iptv/artwork/$kind/$id"
        view.tag = target; cache.get(target)?.let { view.setImageBitmap(it); return }
        scope.launch {
            try { val bitmap = withContext(Dispatchers.IO) { slots.withPermit { cache.get(target) ?: fetch(target)?.also { cache.put(target, it) } } }; if (view.tag == target && bitmap != null) view.setImageBitmap(bitmap) }
            catch (error: Exception) { if (error is CancellationException) throw error }
        }
    }
    private fun fetch(target: String): Bitmap? {
        val uri = URI(target); val origin = URI(BuildConfig.ENGINE_URL); val trusted = uri.scheme == origin.scheme && uri.host == origin.host && uri.port == origin.port
        if (!trusted && uri.scheme != "https") return null
        val connection = URL(target).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 5000; connection.readTimeout = 5000; connection.instanceFollowRedirects = false
            if (trusted) connection.setRequestProperty("Authorization", "Bearer $token")
            if (connection.responseCode != 200 || connection.contentLengthLong > 2 * 1024 * 1024) return null
            val bytes = connection.inputStream.use { input -> val output = ByteArrayOutputStream(); val chunk = ByteArray(8192)
                while (true) { val count = input.read(chunk); if (count < 0) break; if (output.size() + count > 2 * 1024 * 1024) return null; output.write(chunk, 0, count) }; output.toByteArray() }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > 16000 || bounds.outHeight > 16000) return null
            var sample = 1; while (bounds.outWidth / sample > 400 || bounds.outHeight / sample > 600) sample *= 2
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        } finally { connection.disconnect() }
    }
}
