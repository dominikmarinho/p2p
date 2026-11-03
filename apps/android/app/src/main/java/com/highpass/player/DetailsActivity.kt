package com.highpass.player

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject

class DetailsActivity : ComponentActivity() {
    private lateinit var item: JSONObject
    private lateinit var api: EngineApi
    private lateinit var library: LibraryStore
    private lateinit var message: TextView
    private var playing: Job? = null
    private fun dp(value: Int) = PlayerTheme.dp(this, value)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        item = runCatching { JSONObject(intent.getStringExtra("item") ?: "") }.getOrNull() ?: run { finish(); return }
        val session = SessionStore(this).read() ?: run { finish(); return }; api = EngineApi(this); library = LibraryStore(this, session.getJSONObject("account").optString("accountId"))
        val wide = resources.configuration.screenWidthDp >= 700
        val root = PlayerTheme.column(this, 20).apply { setBackgroundColor(PlayerTheme.background) }
        root.addView(PlayerTheme.button(this, "← Voltar à biblioteca") { finish() }, LinearLayout.LayoutParams(-2, dp(48)))
        val header = PlayerTheme.row(this).apply { gravity = Gravity.TOP; setPadding(0, dp(20), 0, dp(20)) }
        val art = FrameLayout(this).apply { background = PlayerTheme.shape(this@DetailsActivity, PlayerTheme.elevated); clipToOutline = true }
        art.addView(PlayerTheme.text(this, item.optString("name").take(1), 52f, PlayerTheme.accent, true).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(-1, -1)); val image = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }; art.addView(image, FrameLayout.LayoutParams(-1, -1)); ArtworkLoader(lifecycleScope, session.getString("token")).load(image, item)
        header.addView(art, LinearLayout.LayoutParams(dp(if (wide) 155 else 94), dp(if (wide) 220 else 138)).apply { marginEnd = dp(if (wide) 24 else 16) })
        val info = PlayerTheme.column(this)
        info.addView(PlayerTheme.label(this, if (item.optString("kind") == "series") "SÉRIES · TEMPORADAS E EPISÓDIOS" else "FILMES · SOB DEMANDA"))
        info.addView(PlayerTheme.text(this, item.optString("name"), if (wide) 30f else 21f, bold = true).apply { maxLines = 3; setPadding(0, dp(14), 0, dp(16)) })
        info.addView(PlayerTheme.text(this, "P2P automático · HTTP de contingência\nFavoritos e reprodução na sua conta", 13f, PlayerTheme.muted))
        var favorite: Button? = null
        favorite = PlayerTheme.button(this, if (library.contains(item)) "♥ Remover dos favoritos" else "♡ Adicionar aos favoritos") { val added = library.toggle(item); favorite?.text = if (added) "♥ Remover dos favoritos" else "♡ Adicionar aos favoritos" }
        info.addView(favorite, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(18) }); header.addView(info, LinearLayout.LayoutParams(0, -2, 1f)); root.addView(header)
        message = PlayerTheme.text(this, "", 14f, PlayerTheme.muted).apply { setPadding(0, dp(12), 0, dp(12)); accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE }; root.addView(message)
        if (item.optString("kind") == "series") loadEpisodes(root, session.getString("token"))
        else {
            val resume = library.last()?.takeIf { it.optString("id") == item.optString("id") && it.optString("kind") == "movie" }?.optLong("positionMs") ?: item.optLong("positionMs")
            if (resume > 1000) root.addView(PlayerTheme.button(this, "Continuar de ${resume / 60000} min", true) { play(JSONObject(item.toString()).put("positionMs", resume)) }, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
            val watch = PlayerTheme.button(this, "▶ Assistir desde o início", resume <= 1000) { play(JSONObject(item.toString()).put("positionMs", 0)) }; root.addView(watch, LinearLayout.LayoutParams(-1, dp(54))); watch.requestFocus()
            message.text = "Áudio e legendas disponíveis podem ser selecionados nos controles do player."
        }
        PlayerTheme.edgeToEdge(this, root, 12); setContentView(root)
    }
    private fun loadEpisodes(root: LinearLayout, token: String) {
        val seasons = Spinner(this).apply { background = PlayerTheme.focus(this@DetailsActivity); contentDescription = "Temporada" }
        val list = ListView(this).apply { selector = PlayerTheme.focus(this@DetailsActivity); dividerHeight = dp(8); divider = android.graphics.drawable.ColorDrawable(PlayerTheme.background) }
        root.addView(seasons, LinearLayout.LayoutParams(-1, dp(48))); root.addView(list, LinearLayout.LayoutParams(-1, 0, 1f)); message.text = "Carregando episódios…"
        lifecycleScope.launch {
            try {
                val values = api.array("series/${item.getString("id")}"); val episodes = (0 until values.length()).map { values.getJSONObject(it).put("kind", "episode").put("seriesId", item.getString("id")).put("image", item.optString("image")).put("artworkKind", "series").put("artworkId", item.getString("id")) }
                val available = episodes.map { it.optString("season") }.distinct().sortedBy { it.toIntOrNull() ?: Int.MAX_VALUE }; var visible = episodes
                fun show(season: String?) { visible = episodes.filter { season == null || it.optString("season") == season }; list.adapter = CatalogAdapter(this@DetailsActivity, visible, false, ArtworkLoader(lifecycleScope, token)); message.text = "${visible.size} episódios · selecione para assistir" }
                seasons.adapter = ArrayAdapter(this@DetailsActivity, android.R.layout.simple_spinner_dropdown_item, listOf("Todas as temporadas") + available.map { "Temporada $it" })
                seasons.onItemSelectedListener = object : AdapterView.OnItemSelectedListener { override fun onNothingSelected(parent: AdapterView<*>?) {}; override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) { show(if (position == 0) null else available[position - 1]) } }
                show(null); list.setOnItemClickListener { _, _, position, _ -> visible.getOrNull(position)?.let { play(it) } }; list.requestFocus()
            } catch (error: Exception) { if (error is CancellationException) throw error; message.text = error.message ?: "Não foi possível carregar episódios" }
        }
    }
    private fun play(content: JSONObject) {
        playing?.cancel(); message.text = "Preparando reprodução…"
        playing = lifecycleScope.launch {
            try { val body = JSONObject().put("kind", content.optString("kind")).put("id", content.getString("id")).put("client", "android"); content.optString("seriesId").takeIf { it.isNotEmpty() }?.let { body.put("seriesId", it) }; val playback = api.json("playback", "POST", body); library.remember(content, content.optLong("positionMs")); message.text = ""; startActivity(Intent(this@DetailsActivity, PlayerActivity::class.java).putExtra("playback", playback.toString()).putExtra("item", content.toString()).putExtra("title", content.optString("name"))) }
            catch (error: Exception) { if (error is CancellationException) throw error; message.text = error.message ?: "Conteúdo indisponível" }
        }
    }
}
