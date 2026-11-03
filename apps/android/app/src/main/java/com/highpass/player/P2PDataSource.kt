package com.highpass.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import java.io.ByteArrayOutputStream
import java.io.IOException

@UnstableApi
class P2PDataSource(private val bridge: P2PBridge, token: String) : BaseDataSource(true) {
    private val http = DefaultHttpDataSource.Factory().setConnectTimeoutMs(10000).setReadTimeoutMs(15000).setAllowCrossProtocolRedirects(false).setDefaultRequestProperties(mapOf("Authorization" to "Bearer $token")).createDataSource()
    private var buffered: ByteArray? = null
    private var offset = 0
    private var uri: Uri? = null
    private var opened = false
    private var usingHttp = false
    override fun open(dataSpec: DataSpec): Long {
        transferInitializing(dataSpec); uri = dataSpec.uri; offset = 0; buffered = null
        val p2p = bridge.load(dataSpec.uri.toString(), dataSpec.position, dataSpec.length)
        if (p2p != null) {
            buffered = p2p; usingHttp = false; opened = true; transferStarted(dataSpec); return p2p.size.toLong()
        }
        usingHttp = true
        val length = http.open(dataSpec)
        val type = http.responseHeaders.entries.firstOrNull { it.key.equals("Content-Type", true) }?.value?.firstOrNull().orEmpty()
        if (type.contains("mpegurl", true) || dataSpec.uri.path.orEmpty().endsWith(".m3u8")) {
            val output = ByteArrayOutputStream(); val chunk = ByteArray(8192)
            while (true) { val count = http.read(chunk, 0, chunk.size); if (count == C.RESULT_END_OF_INPUT) break; if (output.size() + count > 1024 * 1024) throw IOException("Playlist acima de 1 MiB"); output.write(chunk, 0, count) }
            val bytes = output.toByteArray(); buffered = bytes; http.close(); usingHttp = false
            bridge.playlist(dataSpec.uri.toString(), String(bytes)); bridge.http(bytes.size)
            opened = true; transferStarted(dataSpec); return bytes.size.toLong()
        }
        opened = true; transferStarted(dataSpec); return length
    }
    override fun read(buffer: ByteArray, position: Int, length: Int): Int {
        if (length == 0) return 0
        val bytes = buffered
        if (bytes != null) {
            if (offset >= bytes.size) return C.RESULT_END_OF_INPUT
            val count = minOf(length, bytes.size - offset); bytes.copyInto(buffer, position, offset, offset + count); offset += count; bytesTransferred(count); return count
        }
        val count = http.read(buffer, position, length)
        if (count > 0) { bytesTransferred(count); bridge.http(count) }
        return count
    }
    override fun getUri(): Uri? = uri
    override fun getResponseHeaders(): Map<String, List<String>> = if (usingHttp) http.responseHeaders else emptyMap()
    override fun close() {
        try { if (usingHttp) http.close() } finally { buffered = null; uri = null; usingHttp = false; if (opened) { opened = false; transferEnded() } }
    }
}
