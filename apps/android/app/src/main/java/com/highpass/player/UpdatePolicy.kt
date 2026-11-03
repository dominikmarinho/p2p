package com.highpass.player

import java.net.URI
import java.security.MessageDigest

data class ClientRelease(val versionCode: Long, val versionName: String, val downloadUrl: String, val sha256: String, val size: Long, val packageName: String, val minSdk: Int, val notes: String)

object UpdatePolicy {
    const val MAX_APK_BYTES = 128L * 1024 * 1024
    fun validate(release: ClientRelease, engineUrl: String, applicationId: String, sdk: Int) {
        require(release.versionCode > 0 && release.versionName.length in 1..40) { "Versão de atualização inválida" }
        require(release.packageName == applicationId) { "A atualização pertence a outro aplicativo" }
        require(release.minSdk in 26..sdk) { "Esta versão exige um Android mais recente" }
        require(release.size in 1..MAX_APK_BYTES && Regex("^[a-fA-F0-9]{64}$").matches(release.sha256)) { "Dados do pacote inválidos" }
        val base = URI(engineUrl); val target = base.resolve(release.downloadUrl)
        require(target.scheme == base.scheme && target.host == base.host && target.port == base.port && target.rawUserInfo == null && target.rawQuery == null && target.rawFragment == null) { "Origem da atualização não autorizada" }
        require(target.scheme == "https" || (target.scheme == "http" && target.host in listOf("10.0.2.2", "127.0.0.1", "localhost"))) { "A atualização exige HTTPS" }
        require(Regex("^/downloads/android/highpass-[0-9]+\\.apk$").matches(target.path)) { "Endereço do pacote inválido" }
    }
    fun hashMatches(actual: ByteArray, expected: String) = MessageDigest.isEqual(actual, expected.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
}
