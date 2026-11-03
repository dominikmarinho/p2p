package com.highpass.player

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

class ApiFailure(val status: Int, message: String) : IOException(message)

class EngineApi(context: Context) {
    private val store = SessionStore(context.applicationContext)
    suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): String = withContext(Dispatchers.IO) {
        val connection = URL(BuildConfig.ENGINE_URL + "/api/iptv/" + path).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10000; connection.readTimeout = 15000; connection.requestMethod = method
            connection.instanceFollowRedirects = false
            store.token()?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) { connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json"); connection.outputStream.use { it.write(body.toString().toByteArray()) } }
            val status = connection.responseCode
            if (status == 204) return@withContext ""
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { input ->
                val output = ByteArrayOutputStream(); val chunk = ByteArray(8192)
                while (true) { val count = input.read(chunk); if (count < 0) break; if (output.size() + count > 4 * 1024 * 1024) throw IOException("Resposta acima do limite"); output.write(chunk, 0, count) }; output.toByteArray()
            } ?: byteArrayOf()
            if (bytes.size > 4 * 1024 * 1024) throw IOException("Resposta acima do limite")
            val text = String(bytes)
            if (status !in 200..299) throw ApiFailure(status, runCatching { JSONObject(text).optString("message") }.getOrDefault("Serviço indisponível"))
            text
        } finally { connection.disconnect() }
    }
    suspend fun json(path: String, method: String = "GET", body: JSONObject? = null) = JSONObject(request(path, method, body))
    suspend fun array(path: String) = JSONArray(request(path))
}
