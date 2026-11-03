package com.highpass.player

import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import kotlin.math.roundToInt

@UnstableApi
class PlayerActivity : ComponentActivity() {
    private var player: ExoPlayer? = null
    private var bridge: P2PBridge? = null
    private lateinit var playerView: PlayerView
    private var resumePosition = 0L
    private var fallbackUsed = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = FrameLayout(this); playerView = PlayerView(this).apply { id = View.generateViewId(); useController = true; isFocusable = true; controllerShowTimeoutMs = 5000 }
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))
        val stats = TextView(this).apply { text = "P2P · aguardando conexão"; setTextColor(android.graphics.Color.rgb(101, 227, 177)); setBackgroundColor(0xCC0B1019.toInt()); setPadding(16, 10, 16, 10); textSize = 11f }
        root.addView(stats, FrameLayout.LayoutParams(-2, -2, android.view.Gravity.TOP or android.view.Gravity.END))
        setContentView(root)
        start(root, stats)
    }
    private fun start(root: FrameLayout, stats: TextView) {
        val playback = runCatching { JSONObject(intent.getStringExtra("playback") ?: "") }.getOrNull() ?: run { finish(); return }
        val enabled = getSharedPreferences("highpass-settings", MODE_PRIVATE).getBoolean("p2p", true)
        val token = SessionStore(this).token() ?: run { finish(); return }
        val transport = if (playback.optBoolean("isHls")) P2PBridge(this, playback, token, enabled) { raw ->
            runCatching { val value = JSONObject(raw); val p2pPercentage = (value.optDouble("p2pPercentage", 0.0) * 10).roundToInt() / 10.0; val httpPercentage = if (value.optDouble("totalDownloaded", 0.0) > 0) 100 - p2pPercentage else 0.0; stats.text = "HTTP ${"%.1f".format(httpPercentage)}% · P2P ${"%.1f".format(p2pPercentage)}% · ${"%.1f".format(value.optDouble("totalDownloaded") / 1048576)} MB · ${value.optInt("peers")} peers  ↓ ${value.optDouble("downloadRate").toInt() / 1024} KB/s  ↑ ${value.optDouble("uploadRate").toInt() / 1024} KB/s  · ${value.optDouble("saving").toInt()}% economia" }
        } else null; bridge = transport
        val factory: DataSource.Factory = if (transport != null) {
            root.addView(transport.webView, FrameLayout.LayoutParams(1, 1)); transport.webView.alpha = 0.01f
            DataSource.Factory { P2PDataSource(transport, token) }
        } else { stats.text = "Reprodução HTTP"; DefaultHttpDataSource.Factory().setDefaultRequestProperties(mapOf("Authorization" to "Bearer $token")).setConnectTimeoutMs(10000).setReadTimeoutMs(15000) }
        val engine = ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(factory)).setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(15000, 30000, 1000, 2000).build()).build()
        player = engine; playerView.player = engine
        engine.addListener(object : Player.Listener { override fun onPlayerError(error: PlaybackException) {
            val direct = playback.optString("directUrl")
            if (!fallbackUsed && direct.isNotEmpty() && direct != playback.optString("url")) {
                fallbackUsed = true; val position = engine.currentPosition; transport?.httpOnly(); stats.text = "Continuando por HTTP…"
                engine.setMediaItem(MediaItem.fromUri(BuildConfig.ENGINE_URL + direct), position); engine.prepare(); engine.playWhenReady = true
            } else { stats.text = "Reprodução indisponível. Volte e selecione novamente."; playerView.showController() }
        } })
        val item = MediaItem.Builder().setUri(Uri.parse(BuildConfig.ENGINE_URL + playback.getString("url"))).setMediaId(playback.getString("swarmId")).apply { if (playback.optBoolean("isHls")) setMimeType(MimeTypes.APPLICATION_M3U8) }.build()
        engine.setMediaItem(item, if (playback.optBoolean("isLive")) androidx.media3.common.C.TIME_UNSET else 0L); if (resumePosition > 0) engine.seekTo(resumePosition); engine.prepare(); engine.playWhenReady = true
        playerView.requestFocus()
    }
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (::playerView.isInitialized && playerView.dispatchKeyEvent(event)) return true
        if (event.action == KeyEvent.ACTION_DOWN && event.keyCode in listOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER)) { playerView.showController(); return true }
        return super.dispatchKeyEvent(event)
    }
    override fun onStop() { super.onStop(); resumePosition = player?.currentPosition ?: 0; playerView.player = null; bridge?.close(); bridge = null; player?.release(); player = null; finish() }
}
