package com.highpass.player

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class AppUpdates(private val context: Context) {
    private fun connect(path: String) = (URL(URL(BuildConfig.ENGINE_URL), path).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false; connectTimeout = 8000; readTimeout = 15000; setRequestProperty("Cache-Control", "no-cache")
    }
    suspend fun check(): ClientRelease = withContext(Dispatchers.IO) {
        val connection = connect(if (BuildConfig.TRANSPORT == "p2p") "/downloads/android/p2p/latest.json" else "/downloads/android/latest.json")
        try {
            if (connection.responseCode != 200) throw IOException("Não foi possível consultar atualizações. Tente novamente.")
            val bytes = connection.inputStream.use { input ->
                val output = ByteArrayOutputStream(); val chunk = ByteArray(2048)
                while (true) { val count = input.read(chunk); if (count < 0) break; if (output.size() + count > 16384) throw IOException("Resposta de atualização inválida"); output.write(chunk, 0, count) }; output.toByteArray()
            }
            val data = JSONObject(String(bytes, Charsets.UTF_8))
            ClientRelease(data.getLong("versionCode"), data.getString("versionName"), data.getString("downloadUrl"), data.getString("sha256"), data.getLong("sizeBytes"), data.getString("applicationId"), data.getInt("minSdk"), data.optString("releaseNotes").take(2000)).also { UpdatePolicy.validate(it, BuildConfig.ENGINE_URL, context.packageName, Build.VERSION.SDK_INT) }
        } finally { connection.disconnect() }
    }
    suspend fun download(release: ClientRelease, progress: (Int) -> Unit): File = withContext(Dispatchers.IO) {
        UpdatePolicy.validate(release, BuildConfig.ENGINE_URL, context.packageName, Build.VERSION.SDK_INT)
        val folder = File(context.cacheDir, "updates").apply { mkdirs() }
        val partial = File(folder, "highpass-${release.versionCode}.part.apk"); val target = File(folder, "highpass-${release.versionCode}.apk")
        val connection = connect(release.downloadUrl)
        try {
            if (connection.responseCode != 200) throw IOException("Download indisponível")
            if (connection.contentLengthLong > UpdatePolicy.MAX_APK_BYTES) throw IOException("Pacote acima do limite")
            val digest = MessageDigest.getInstance("SHA-256"); var received = 0L; var lastPercent = -1
            connection.inputStream.use { input -> partial.outputStream().use { output ->
                val buffer = ByteArray(65536)
                while (true) { currentCoroutineContext().ensureActive(); val count = input.read(buffer); if (count < 0) break
                    received += count; if (received > release.size) throw IOException("Tamanho do download inválido")
                    output.write(buffer, 0, count); digest.update(buffer, 0, count)
                    val percent = (received * 100 / release.size).toInt(); if (percent != lastPercent) { lastPercent = percent; withContext(Dispatchers.Main) { progress(percent) } }
                }
            } }
            if (received != release.size || !UpdatePolicy.hashMatches(digest.digest(), release.sha256)) throw IOException("O pacote não passou na verificação. Baixe novamente.")
            verifyPackage(partial, release)
            if (target.exists()) target.delete()
            if (!partial.renameTo(target)) throw IOException("Não foi possível preparar a instalação")
            target
        } finally { connection.disconnect(); partial.delete() }
    }
    @Suppress("DEPRECATION")
    private fun verifyPackage(file: File, release: ClientRelease) {
        val manager = context.packageManager; val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val candidate = manager.getPackageArchiveInfo(file.absolutePath, flags) ?: throw IOException("Pacote Android inválido")
        val installed = manager.getPackageInfo(context.packageName, flags)
        val version = if (Build.VERSION.SDK_INT >= 28) candidate.longVersionCode else candidate.versionCode.toLong()
        if (candidate.packageName != context.packageName || version != release.versionCode || version <= BuildConfig.VERSION_CODE) throw IOException("Versão ou aplicativo incompatível")
        val wanted = if (Build.VERSION.SDK_INT >= 28) installed.signingInfo?.apkContentsSigners else installed.signatures
        val found = if (Build.VERSION.SDK_INT >= 28) candidate.signingInfo?.apkContentsSigners else candidate.signatures
        if (wanted.isNullOrEmpty() || found.isNullOrEmpty() || wanted.map { it.toCharsString() }.toSet() != found.map { it.toCharsString() }.toSet()) throw IOException("A assinatura não corresponde ao aplicativo instalado")
    }
}
