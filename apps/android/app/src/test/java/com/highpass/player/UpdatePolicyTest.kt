package com.highpass.player

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

class UpdatePolicyTest {
    private val release = ClientRelease(2, "1.1.0", "/downloads/android/highpass-2.apk", "a".repeat(64), 5000000, "com.highpass.player", 26, "Melhorias")
    @Test fun acceptsOnlyTheConfiguredOriginAndPackage() {
        UpdatePolicy.validate(release, "https://p2p.remoto.api.br", "com.highpass.player", 35)
        for (target in listOf("https://evil.example/downloads/android/highpass-2.apk", "http://p2p.remoto.api.br/downloads/android/highpass-2.apk", "/downloads/android/../../other.apk", "https://user@p2p.remoto.api.br/downloads/android/highpass-2.apk")) {
            assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.validate(release.copy(downloadUrl = target), "https://p2p.remoto.api.br", "com.highpass.player", 35) }
        }
        assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.validate(release.copy(packageName = "another.app"), "https://p2p.remoto.api.br", "com.highpass.player", 35) }
    }
    @Test fun keepsHttpAndP2pUpdatesInTheirOwnPackages() {
        val p2p = release.copy(packageName = "com.highpass.player.p2p", downloadUrl = "/downloads/android/p2p/highpass-2.apk")
        UpdatePolicy.validate(p2p, "https://p2p.remoto.api.br", "com.highpass.player.p2p", 35)
        assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.validate(p2p, "https://p2p.remoto.api.br", "com.highpass.player", 35) }
        assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.validate(release, "https://p2p.remoto.api.br", "com.highpass.player.p2p", 35) }
    }
    @Test fun rejectsCorruptOrOversizedMetadata() {
        for (item in listOf(release.copy(sha256 = "not-a-hash"), release.copy(size = UpdatePolicy.MAX_APK_BYTES + 1), release.copy(minSdk = 36), release.copy(versionCode = -1))) {
            assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.validate(item, "https://p2p.remoto.api.br", "com.highpass.player", 35) }
        }
    }
    @Test fun identifiesCorruptedDownloadBytes() {
        val expected = MessageDigest.getInstance("SHA-256").digest("apk-correct".toByteArray()).joinToString("") { "%02x".format(it) }
        assertTrue(UpdatePolicy.hashMatches(MessageDigest.getInstance("SHA-256").digest("apk-correct".toByteArray()), expected))
        assertFalse(UpdatePolicy.hashMatches(MessageDigest.getInstance("SHA-256").digest("apk-altered".toByteArray()), expected))
    }
}
