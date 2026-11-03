package com.highpass.player

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import androidx.media3.ui.AspectRatioFrameLayout
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.roundToInt

@UnstableApi
class PlayerActivity : ComponentActivity() {
    private var player: ExoPlayer? = null
    private var bridge: P2PBridge? = null
    private lateinit var root: LinearLayout
    private lateinit var content: LinearLayout
    private lateinit var layoutButton: Button
    private lateinit var playerView: PlayerView
    private lateinit var videoFrame: FrameLayout
    private lateinit var playback: JSONObject
    private lateinit var item: JSONObject
    private lateinit var title: TextView
    private lateinit var status: TextView
    private lateinit var traffic: TextView
    private lateinit var guide: TextView
    private lateinit var loading: TextView
    private lateinit var sidebar: LinearLayout
    private lateinit var top: LinearLayout
    private lateinit var guideBox: LinearLayout
    private lateinit var channelList: ListView
    private lateinit var api: EngineApi
    private lateinit var token: String
    private lateinit var library: LibraryStore
    private var position = 0L
    private var fallbackUsed = false
    private var recoverFile = false
    private var fullScreen = true
    @Volatile private var stopped = true
    private var probing = false
    private var lastProbe = 0L
    private val handler = Handler(Looper.getMainLooper())
    private var executor: ExecutorService? = null
    private var switchJob: Job? = null
    private var epgJob: Job? = null
    private val wide get() = resources.configuration.screenWidthDp >= 700
    private fun dp(value: Int) = PlayerTheme.dp(this, value)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        fullScreen = savedInstanceState?.getBoolean("fullScreen", true) ?: true
        val television = resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION || packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        if (!television) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        playback = runCatching { JSONObject(savedInstanceState?.getString("playback") ?: intent.getStringExtra("playback") ?: "") }.getOrNull() ?: run { finish(); return }
        item = runCatching { JSONObject(savedInstanceState?.getString("item") ?: intent.getStringExtra("item") ?: "{}") }.getOrDefault(JSONObject()); if (!item.has("name")) item.put("name", intent.getStringExtra("title") ?: "Highpass Play")
        val session = SessionStore(this).read() ?: run { finish(); return }; token = session.getString("token"); library = LibraryStore(this, session.getJSONObject("account").optString("accountId")); api = EngineApi(this)
        position = savedInstanceState?.getLong("position") ?: item.optLong("positionMs")
        root = PlayerTheme.row(this).apply { setBackgroundColor(PlayerTheme.background); gravity = Gravity.TOP }
        sidebar = PlayerTheme.column(this, 12).apply { setBackgroundColor(PlayerTheme.sidebar) }
        sidebar.addView(PlayerTheme.brand(this)); sidebar.addView(PlayerTheme.label(this, "AGORA AO VIVO").apply { setPadding(0, dp(28), 0, dp(16)) })
        channelList = ListView(this).apply { id = View.generateViewId(); selector = PlayerTheme.focus(this@PlayerActivity); dividerHeight = dp(6); divider = android.graphics.drawable.ColorDrawable(PlayerTheme.sidebar) }; sidebar.addView(channelList, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(sidebar, LinearLayout.LayoutParams(dp(if (wide) 218 else 168), -1)); sidebar.visibility = if (wide && playback.optBoolean("isLive")) View.VISIBLE else View.GONE
        content = PlayerTheme.column(this, 12); root.addView(content, LinearLayout.LayoutParams(0, -1, 1f))
        top = PlayerTheme.row(this); top.addView(PlayerTheme.button(this, "← Voltar") { finish() }, LinearLayout.LayoutParams(dp(96), dp(46)))
        title = PlayerTheme.text(this, item.optString("name"), if (wide) 21f else 16f, bold = true).apply { maxLines = 2; setPadding(dp(14), 0, dp(8), 0) }; top.addView(title, LinearLayout.LayoutParams(0, -2, 1f)); top.addView(PlayerTheme.button(this, "Tela cheia") { toggleFullscreen() }, LinearLayout.LayoutParams(-2, dp(46))); content.addView(top)
        status = PlayerTheme.text(this, "Conectando à transmissão…", 12f, PlayerTheme.accent).apply { setPadding(0, dp(10), 0, dp(12)) }; content.addView(status)
        videoFrame = FrameLayout(this).apply { setBackgroundColor(android.graphics.Color.BLACK); background = PlayerTheme.shape(this@PlayerActivity, android.graphics.Color.BLACK); clipToOutline = true }
        playerView = PlayerView(this).apply { id = View.generateViewId(); useController = true; resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT; setShutterBackgroundColor(android.graphics.Color.BLACK); isFocusable = true; controllerShowTimeoutMs = 5000; setShowSubtitleButton(true); nextFocusLeftId = channelList.id; setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING) }; videoFrame.addView(playerView, FrameLayout.LayoutParams(-1, -1))
        loading = PlayerTheme.text(this, "Preparando reprodução…", 16f, PlayerTheme.muted).apply { gravity = Gravity.CENTER; setBackgroundColor(0x88090F18.toInt()) }; videoFrame.addView(loading, FrameLayout.LayoutParams(-1, -1)); content.addView(videoFrame, LinearLayout.LayoutParams(-1, if (wide) 0 else dp(220), if (wide) 1f else 0f))
        val trafficLine = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; setBackgroundColor(android.graphics.Color.TRANSPARENT); setPadding(dp(12), dp(10), dp(12), dp(8)); importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
        traffic = PlayerTheme.text(this, "Conectando · HTTP 0,0% · P2P 0,0% · 0 peers · ↓ 0 KB/s · ↑ 0 KB/s · 0 MB", if (wide) 12f else 10f, android.graphics.Color.WHITE).apply { setSingleLine(true); setShadowLayer(4f, 0f, 1f, android.graphics.Color.BLACK); contentDescription = "Tráfego de vídeo" }
        trafficLine.addView(traffic, FrameLayout.LayoutParams(-2, -2)); videoFrame.addView(trafficLine, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        guideBox = PlayerTheme.column(this, 12); guide = PlayerTheme.text(this, "", 13f, PlayerTheme.muted); guideBox.addView(guide); content.addView(guideBox, LinearLayout.LayoutParams(-1, -2))
        layoutButton = PlayerTheme.button(this, if (playback.optBoolean("isLive")) "☰ Canais" else "Opções") { setFullscreen(false) }.apply {
            id = View.generateViewId(); textSize = 12f; contentDescription = if (playback.optBoolean("isLive")) "Exibir canais e informações" else "Exibir informações de reprodução"
            background = android.graphics.drawable.StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), PlayerTheme.shape(this@PlayerActivity, 0x99000000.toInt(), radius = 8, stroke = PlayerTheme.accent, width = 2))
                addState(intArrayOf(), PlayerTheme.shape(this@PlayerActivity, 0x55000000, radius = 8, stroke = 0x77FFFFFF, width = 1))
            }
        }
        videoFrame.addView(layoutButton, FrameLayout.LayoutParams(-2, dp(46), Gravity.TOP or Gravity.END).apply { topMargin = dp(42); marginEnd = dp(12) })
        playerView.nextFocusUpId = layoutButton.id
        playerView.setFullscreenButtonClickListener { setFullscreen(it) }
        playerView.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility -> layoutButton.visibility = if (fullScreen && visibility == View.VISIBLE) View.VISIBLE else View.GONE })
        setContentView(root); setFullscreen(fullScreen, false)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() { if (fullScreen) setFullscreen(false) else finish() } })
        if (playback.optBoolean("isLive")) loadChannels()
    }
    override fun onStart() { super.onStart(); if (::playback.isInitialized && player == null && ::token.isInitialized) startStream() }
    private fun startStream() {
        stopped = false; fallbackUsed = false; recoverFile = false; probing = false; lastProbe = 0; executor = Executors.newSingleThreadExecutor(); loading.visibility = View.VISIBLE; loading.text = "Conectando à transmissão…"; title.text = item.optString("name")
        status.text = "${if (playback.optBoolean("isLive")) "● AO VIVO" else "SOB DEMANDA"} · Somente ${BuildConfig.TRANSPORT.uppercase()}"
        val enabled = BuildConfig.TRANSPORT == "p2p"
        val transport = if (enabled && playback.optBoolean("isHls")) P2PBridge(this, playback, token, enabled) { raw -> runCatching { updateTraffic(JSONObject(raw)) } } else null; bridge = transport
        val factory: DataSource.Factory = if (transport != null) { videoFrame.addView(transport.webView, FrameLayout.LayoutParams(1, 1)); transport.webView.alpha = .01f; DataSource.Factory { P2PDataSource(transport, token) } } else DefaultHttpDataSource.Factory().setDefaultRequestProperties(mapOf("Authorization" to "Bearer $token")).setConnectTimeoutMs(10000).setReadTimeoutMs(15000)
        val engine = ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(factory)).setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(15000, 30000, 1000, 2000).build()).build(); player = engine; playerView.player = engine
        engine.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) { loading.visibility = if (state == Player.STATE_BUFFERING || state == Player.STATE_IDLE) View.VISIBLE else View.GONE; if (state == Player.STATE_READY) status.text = if (fallbackUsed) "HTTP · reprodução direta" else if (playback.optBoolean("isLive")) "● AO VIVO · transmissão em reprodução" else "SOB DEMANDA · reprodução em andamento" }
            override fun onPlayerError(error: PlaybackException) {
                val direct = playback.optString("directUrl")
                if (BuildConfig.TRANSPORT == "http" && !fallbackUsed && direct.isNotEmpty() && direct != playback.optString("url")) { fallbackUsed = true; recoverFile = error.errorCode in 2000..2999; val at = engine.currentPosition; if (playback.optString("sourceFormat") != "m3u8") transport?.httpOnly(); status.text = "HTTP · recuperando conexão"; engine.setMediaItem(MediaItem.fromUri(BuildConfig.ENGINE_URL + direct), at.coerceAtLeast(0)); engine.prepare(); engine.playWhenReady = true }
                else { loading.text = "${if (BuildConfig.TRANSPORT == "p2p") "Entrega P2P indisponível (sem HTTP)." else "Reprodução HTTP indisponível."}\nPressione OK para tentar novamente ou volte à biblioteca."; loading.visibility = View.VISIBLE; status.text = "Verifique a conexão ou escolha outro conteúdo"; playerView.showController() }
            }
        })
        val source = MediaItem.Builder().setUri(Uri.parse(BuildConfig.ENGINE_URL + playback.getString("url"))).setMediaId(playback.getString("swarmId")).apply { if (playback.optBoolean("isHls")) setMimeType(MimeTypes.APPLICATION_M3U8) }.build()
        engine.setMediaItem(source, if (playback.optBoolean("isLive")) C.TIME_UNSET else position.coerceAtLeast(0)); engine.prepare(); engine.playWhenReady = true; playerView.requestFocus(); loadGuide()
        handler.postDelayed(object : Runnable { override fun run() {
            if (stopped || player !== engine) return
            transport?.playhead(engine.currentPosition.coerceAtLeast(0) / 1000.0)
            if (transport == null && playback.optString("statsPath").isNotEmpty()) lifecycleScope.launch { runCatching { updateTraffic(api.json(playback.getString("statsPath").removePrefix("/api/iptv/"))) } }
            if (fallbackUsed && recoverFile && !probing && SystemClock.elapsedRealtime() - lastProbe > 15000) {
                probing = true; lastProbe = SystemClock.elapsedRealtime(); executor?.execute {
                    val usable = runCatching { val connection = URL(BuildConfig.ENGINE_URL + playback.getString("url")).openConnection() as HttpURLConnection; connection.connectTimeout = 5000; connection.readTimeout = 5000; connection.setRequestProperty("Authorization", "Bearer $token"); try { connection.responseCode == 200 && connection.inputStream.bufferedReader().use { it.readLine()?.trim() == "#EXTM3U" } } finally { connection.disconnect() } }.getOrDefault(false)
                    handler.post { if (!stopped && player === engine) { probing = false; if (usable && fallbackUsed) { val at = engine.currentPosition; fallbackUsed = false; recoverFile = false; transport?.resume(); engine.setMediaItem(MediaItem.Builder().setUri(BuildConfig.ENGINE_URL + playback.getString("url")).setMimeType(MimeTypes.APPLICATION_M3U8).build(), at.coerceAtLeast(0)); engine.prepare(); engine.playWhenReady = true } } }
                }
            }
            handler.postDelayed(this, 3000)
        } }, 3000)
    }
    private fun updateTraffic(value: JSONObject) {
        val percentage = (value.optDouble("p2pPercentage", 0.0) * 10).roundToInt() / 10.0; val http = if (value.optDouble("totalDownloaded", 0.0) > 0) 100 - percentage else 0.0
        val mode = if (BuildConfig.TRANSPORT == "http") "HTTP" else when (value.optString("deliveryMode")) { "p2p" -> "P2P ativo"; "http" -> "P2P · aguardando seed"; else -> "P2P · aguardando seed ou peers" }
        traffic.text = "$mode · HTTP ${"%.1f".format(http)}% · P2P ${"%.1f".format(percentage)}% · ${value.optInt("peers")} peers · ↓ ${value.optDouble("downloadRate").toInt() / 1024} KB/s · ↑ ${value.optDouble("uploadRate").toInt() / 1024} KB/s · ${"%.1f".format(value.optDouble("totalDownloaded") / 1048576)} MB"
        if (player?.playbackState == Player.STATE_READY && !fallbackUsed) status.text = if (mode == "P2P ativo") "● P2P ativo · transmissão em reprodução" else "● Transmissão em reprodução · ${BuildConfig.TRANSPORT.uppercase()}"
    }
    private fun loadChannels() {
        lifecycleScope.launch { try { val values = api.json("catalog?kind=live&limit=100").getJSONArray("items"); val channels = (0 until values.length()).map { values.getJSONObject(it) }; channelList.adapter = CatalogAdapter(this@PlayerActivity, channels, false, ArtworkLoader(lifecycleScope, token)); channelList.setSelection(channels.indexOfFirst { it.optString("id") == item.optString("id") }.coerceAtLeast(0)); channelList.setOnItemClickListener { _, _, index, _ -> channels.getOrNull(index)?.let { switch(it) } } } catch (error: Exception) { if (error is CancellationException) throw error; status.text = "Lista de canais indisponível · reprodução atual preservada" } }
    }
    private fun switch(next: JSONObject) {
        if (next.optString("id") == item.optString("id")) { playerView.requestFocus(); return }; switchJob?.cancel(); status.text = "Trocando para ${next.optString("name")}…"
        switchJob = lifecycleScope.launch { try { val descriptor = api.json("playback", "POST", JSONObject().put("kind", "live").put("id", next.getString("id")).put("client", "android")); stopStream(); item = next; playback = descriptor; position = 0; library.remember(next); intent.putExtra("playback", descriptor.toString()).putExtra("item", item.toString()); startStream() } catch (error: Exception) { if (error is CancellationException) throw error; status.text = error.message ?: "Não foi possível trocar o canal" } }
    }
    private fun loadGuide() {
        epgJob?.cancel(); guide.text = if (playback.optBoolean("isLive")) "Consultando guia de programação…" else "Áudio e legendas podem ser selecionados nos controles do player."
        if (!playback.optBoolean("isLive") || item.optString("id").isEmpty()) return
        epgJob = lifecycleScope.launch { try { val values = api.array("epg/${item.getString("id")}"); guide.text = if (values.length() > 0) (0 until minOf(2, values.length())).joinToString("\n") { val row = values.getJSONObject(it); "${row.optString("start").takeLast(8).take(5)}  ${row.optString("title")}" } else "Guia não disponibilizado pela operadora." } catch (error: Exception) { if (error is CancellationException) throw error; guide.text = "Guia temporariamente indisponível." } }
    }
    private fun toggleFullscreen() { setFullscreen(!fullScreen) }
    private fun setFullscreen(enabled: Boolean, focus: Boolean = true) {
        fullScreen = enabled
        sidebar.visibility = if (!enabled && playback.optBoolean("isLive")) View.VISIBLE else View.GONE
        top.visibility = if (enabled) View.GONE else View.VISIBLE; guideBox.visibility = if (enabled) View.GONE else View.VISIBLE; status.visibility = if (enabled) View.GONE else View.VISIBLE
        val padding = if (enabled) 0 else dp(12); content.setPadding(padding, padding, padding, padding)
        root.setBackgroundColor(if (enabled) android.graphics.Color.BLACK else PlayerTheme.background)
        videoFrame.background = if (enabled) android.graphics.drawable.ColorDrawable(android.graphics.Color.BLACK) else PlayerTheme.shape(this, android.graphics.Color.BLACK)
        videoFrame.clipToOutline = !enabled
        videoFrame.layoutParams = (videoFrame.layoutParams as LinearLayout.LayoutParams).apply { height = if (wide || enabled) 0 else dp(220); weight = if (wide || enabled) 1f else 0f }
        playerView.nextFocusLeftId = if (enabled || !playback.optBoolean("isLive")) View.NO_ID else channelList.id
        playerView.setFullscreenButtonState(enabled)
        layoutButton.visibility = if (enabled && playerView.isControllerFullyVisible) View.VISIBLE else View.GONE
        PlayerTheme.playerWindow(this, root, enabled)
        if (focus) { if (!enabled && playback.optBoolean("isLive")) channelList.requestFocus() else playerView.requestFocus() }
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && fullScreen && ::root.isInitialized) PlayerTheme.playerWindow(this, root, true)
    }
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (::playerView.isInitialized) {
            if (event.action == KeyEvent.ACTION_DOWN && event.keyCode == KeyEvent.KEYCODE_MENU) { toggleFullscreen(); return true }
            if (fullScreen && event.action == KeyEvent.ACTION_DOWN && event.keyCode == KeyEvent.KEYCODE_DPAD_UP && !playerView.isControllerFullyVisible) { playerView.showController(); layoutButton.visibility = View.VISIBLE; layoutButton.requestFocus(); return true }
            if (event.action == KeyEvent.ACTION_DOWN && event.keyCode in listOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER) && player?.playerError != null) { val at = player?.currentPosition ?: 0; stopStream(false); position = at; startStream(); return true }
            if (playerView.hasFocus() && playerView.dispatchKeyEvent(event)) return true
        }
        return super.dispatchKeyEvent(event)
    }
    private fun stopStream(releaseSeed: Boolean = true) {
        stopped = true; handler.removeCallbacksAndMessages(null); executor?.shutdownNow(); executor = null; epgJob?.cancel()
        player?.let { engine -> position = engine.currentPosition.coerceAtLeast(0); if (::library.isInitialized && ::item.isInitialized) library.remember(item, if (playback.optBoolean("isLive")) 0 else position) }
        if (::playerView.isInitialized) playerView.player = null; bridge?.let { videoFrame.removeView(it.webView); it.close(releaseSeed && !isChangingConfigurations) }; bridge = null; player?.release(); player = null
    }
    override fun onSaveInstanceState(outState: Bundle) { if (::playback.isInitialized) { outState.putString("playback", playback.toString()); outState.putString("item", item.toString()); outState.putLong("position", player?.currentPosition ?: position); outState.putBoolean("fullScreen", fullScreen) }; super.onSaveInstanceState(outState) }
    override fun onStop() { switchJob?.cancel(); stopStream(); super.onStop() }
}
