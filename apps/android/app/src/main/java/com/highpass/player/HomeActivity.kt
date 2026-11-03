package com.highpass.player

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.text.DateFormat
import java.util.Date

class HomeActivity : ComponentActivity() {
    private lateinit var api: EngineApi
    private lateinit var title: TextView
    private lateinit var status: TextView
    private lateinit var list: ListView
    private lateinit var search: EditText
    private var loadJob: Job? = null
    private var rows = listOf<JSONObject>()
    private var kind = "live"
    private var seriesId: String? = null
    private var page = 0
    private var total = 0
    private val preferences by lazy { getSharedPreferences("highpass-settings", MODE_PRIVATE) }
    private val store by lazy { SessionStore(this) }
    private fun favoritesKey() = "favorites:" + store.read()?.optJSONObject("account")?.optString("accountId")
    private fun favorites() = runCatching { JSONArray(preferences.getString(favoritesKey(), "[]")) }.getOrDefault(JSONArray())
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }
    private fun focusBackground(): StateListDrawable {
        fun shape(color: Int) = GradientDrawable().apply { setColor(color); cornerRadius = 14f }
        return StateListDrawable().apply { addState(intArrayOf(android.R.attr.state_focused), shape(Color.rgb(35, 100, 77))); addState(intArrayOf(android.R.attr.state_pressed), shape(Color.rgb(35, 100, 77))); addState(intArrayOf(), shape(Color.rgb(22, 34, 50))) }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); api = EngineApi(this)
        val portrait = resources.configuration.screenWidthDp < 700
        val root = LinearLayout(this).apply { orientation = if (portrait) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL; setBackgroundColor(Color.rgb(11, 16, 25)); setPadding(dp(20), dp(24), dp(20), dp(20)) }
        val navigation = LinearLayout(this).apply { orientation = if (portrait) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL }
        val navScroll = if (portrait) HorizontalScrollView(this).apply { addView(navigation) } else null
        if (navScroll != null) root.addView(navScroll, LinearLayout.LayoutParams(-1, -2)) else root.addView(navigation, LinearLayout.LayoutParams(dp(220), -1))
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(20, 0, 0, 0) }
        root.addView(content, LinearLayout.LayoutParams(if (portrait) -1 else 0, if (portrait) 0 else -1, 1f))
        title = TextView(this).apply { text = "HIGH PASS · Canais ao vivo"; textSize = 24f; setTextColor(Color.WHITE) }; content.addView(title)
        status = TextView(this).apply { textSize = 13f; setTextColor(Color.rgb(137, 150, 171)); setPadding(0, 10, 0, 10) }; content.addView(status)
        search = EditText(this).apply { hint = "Buscar na lista"; setTextColor(Color.WHITE); setHintTextColor(Color.GRAY); isSingleLine = true; imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH; id = View.generateViewId() }; content.addView(search)
        search.setOnEditorActionListener { _, _, _ -> if (kind in listOf("live", "movie", "series")) { page = 0; loadCatalog() } else display(rows); true }
        list = ListView(this).apply { id = View.generateViewId(); isFocusable = true; dividerHeight = 12; selector = focusBackground(); setPadding(0, 12, 0, 0) }; content.addView(list, LinearLayout.LayoutParams(-1, 0, 1f))
        val favorite = Button(this).apply { text = "♡ Favoritar seleção · MENU no controle"; background = focusBackground(); setTextColor(Color.WHITE); setOnClickListener { toggleFavorite() } }; content.addView(favorite)
        val pagination = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        pagination.addView(Button(this).apply { text = "← Anterior"; setOnClickListener { if (page > 0 && kind in listOf("live", "movie", "series")) { page--; loadCatalog() } } })
        pagination.addView(Button(this).apply { text = "Próxima →"; setOnClickListener { if ((page + 1) * 200 < total && kind in listOf("live", "movie", "series")) { page++; loadCatalog() } } })
        content.addView(pagination)
        list.setOnKeyListener { _, code, event -> if (event.action == KeyEvent.ACTION_DOWN && code == KeyEvent.KEYCODE_MENU) { toggleFavorite(); true } else false }
        list.setOnItemClickListener { _, _, position, _ -> val filtered = filtered(); if (position < filtered.size) select(filtered[position]) }
        list.setOnItemLongClickListener { _, _, position, _ -> toggleFavorite(position); true }
        val choices = listOf("Canais Ao Vivo" to "live", "Filmes" to "movie", "Séries" to "series", "Favoritos" to "favorites", "Configurações" to "settings", "Minha Conta" to "account")
        for ((label, value) in choices) {
            navigation.addView(Button(this).apply { text = label; id = View.generateViewId(); setTextColor(Color.WHITE); background = focusBackground(); setOnClickListener { navigate(value) }; nextFocusRightId = list.id })
        }
        setContentView(root); navigate("live")
    }
    private fun filtered() = rows.filter { it.optString("name").contains(search.text.toString(), ignoreCase = true) }
    private fun display(values: List<JSONObject>) {
        rows = values; val filtered = filtered(); list.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, filtered.map { it.optString("name") }); status.text = "${filtered.size} títulos · Selecione para assistir"; list.requestFocus()
    }
    private fun navigate(value: String) {
        search.text.clear(); seriesId = null; page = 0
        if (value == "settings") { showSettings(); return }
        if (value == "account") { showAccount(); return }
        kind = value; title.text = "HIGH PASS · " + mapOf("live" to "Canais ao vivo", "movie" to "Filmes", "series" to "Séries", "favorites" to "Favoritos")[value]
        if (value == "favorites") { display(favorites().objects()); return }
        loadCatalog()
    }
    private fun loadCatalog() {
        loadJob?.cancel(); status.text = "Carregando…"
        val selectedKind = kind
        val query = URLEncoder.encode(search.text.toString(), "UTF-8")
        loadJob = lifecycleScope.launch {
            try { val response = api.json("catalog?kind=$selectedKind&limit=200&offset=${page * 200}&search=$query"); total = response.optInt("total"); display(response.getJSONArray("items").objects()); status.text = "Página ${page + 1} · $total títulos" }
            catch (failure: Exception) { if (failure is CancellationException) throw failure; status.text = failure.message; if (failure is ApiFailure && failure.status == 401) logout() }
        }
    }
    private fun select(item: JSONObject) {
        val selectedKind = item.optString("kind", kind)
        if (selectedKind == "series") {
            val id = item.getString("id"); lifecycleScope.launch {
                try { seriesId = id; kind = "episode"; display(api.array("series/$id").objects()); title.text = item.optString("name") }
                catch (failure: Exception) { status.text = failure.message }
            }; return
        }
        lifecycleScope.launch {
            try {
                val body = JSONObject().put("kind", selectedKind).put("id", item.getString("id")); seriesId?.let { body.put("seriesId", it) }
                val playback = api.json("playback", "POST", body)
                startActivity(Intent(this@HomeActivity, PlayerActivity::class.java).putExtra("playback", playback.toString()).putExtra("title", item.optString("name")))
            } catch (failure: Exception) { status.text = failure.message }
        }
    }
    private fun toggleFavorite(position: Int = list.selectedItemPosition.coerceAtLeast(0)) {
        val item = filtered().getOrNull(position) ?: return
        if (kind == "episode") return
        val values = favorites().objects().toMutableList(); val index = values.indexOfFirst { it.optString("id") == item.optString("id") && it.optString("kind") == item.optString("kind") }
        if (index >= 0) values.removeAt(index) else { if (values.size >= 500) values.removeAt(0); values.add(item) }
        preferences.edit().putString(favoritesKey(), JSONArray(values).toString()).apply(); Toast.makeText(this, "Favoritos atualizados", Toast.LENGTH_SHORT).show()
        if (kind == "favorites") display(values)
    }
    private fun showSettings() {
        if (store.read()?.optJSONObject("account")?.optBoolean("p2pRequired", false) == true) {
            AlertDialog.Builder(this).setTitle("Distribuição automática").setMessage("Canais, filmes e séries usam P2P quando há entrega disponível. HTTP mantém a reprodução durante falhas, com retorno automático ao P2P.").setPositiveButton("Concluir", null).show(); return
        }
        AlertDialog.Builder(this).setTitle("Configurações").setMultiChoiceItems(arrayOf("Compartilhar segmentos via P2P"), booleanArrayOf(preferences.getBoolean("p2p", true))) { _, _, checked -> preferences.edit().putBoolean("p2p", checked).apply() }.setPositiveButton("Concluir", null).show()
    }
    private fun showAccount() {
        val account = store.read()?.optJSONObject("account") ?: return
        val expiry = DateFormat.getDateTimeInstance().format(Date(account.optLong("expiresAt")))
        AlertDialog.Builder(this).setTitle("Minha conta").setMessage("Usuário: ${account.optString("username")}\nSessão até: $expiry\nConexões: ${account.optInt("maxConnections")}").setPositiveButton("Voltar", null).setNegativeButton("Sair") { _, _ -> lifecycleScope.launch { runCatching { api.request("logout", "POST") }; logout() } }.show()
    }
    private fun logout() { store.clear(); startActivity(Intent(this, LoginActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)); finish() }
}
