package com.highpass.player

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class HomeActivity : ComponentActivity() {
    private lateinit var api: EngineApi
    private lateinit var account: JSONObject
    private lateinit var library: LibraryStore
    private lateinit var artwork: ArtworkLoader
    private lateinit var body: LinearLayout
    private lateinit var heading: TextView
    private lateinit var connection: TextView
    private lateinit var clock: TextView
    private lateinit var search: EditText
    private lateinit var counter: TextView
    private lateinit var catalog: AbsListView
    private var section = "home"
    private var page = 0
    private var total = 0
    private var category = ""
    private var query = ""
    private var rows = emptyList<JSONObject>()
    private var loadJob: Job? = null
    private var categoryJob: Job? = null
    private var searchJob: Job? = null
    private var previewJob: Job? = null
    private var previewTitle: TextView? = null
    private var previewGuide: TextView? = null
    private var previewImage: ImageView? = null
    private var previewItem: JSONObject? = null
    private val menu = mutableMapOf<String, Button>()
    private val counts = mutableMapOf<String, Int>()
    private val countLabels = mutableMapOf<String, TextView>()
    private val handler = Handler(Looper.getMainLooper())
    private val store by lazy { SessionStore(this) }
    private val wide get() = resources.configuration.screenWidthDp >= 700
    private val choices = listOf("home" to "Início", "live" to "Canais ao vivo", "movie" to "Filmes", "series" to "Séries", "favorites" to "Favoritos", "settings" to "Configurações", "account" to "Minha conta")
    private fun dp(value: Int) = PlayerTheme.dp(this, value)
    private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }
    private val tick = object : Runnable { override fun run() { if (::clock.isInitialized) clock.text = SimpleDateFormat("EEE, dd MMM  •  HH:mm", Locale("pt", "BR")).format(Date()); handler.postDelayed(this, 30000) } }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val session = store.read(); if (session == null) { logout(); return }
        account = session.getJSONObject("account"); api = EngineApi(this); library = LibraryStore(this, account.optString("accountId")); artwork = ArtworkLoader(lifecycleScope, session.getString("token"))
        val root = LinearLayout(this).apply { orientation = if (wide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL; setBackgroundColor(PlayerTheme.background) }
        val navigation = PlayerTheme.column(this, if (wide) 18 else 10).apply { setBackgroundColor(PlayerTheme.sidebar) }
        if (wide) {
            navigation.addView(PlayerTheme.brand(this), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14); bottomMargin = dp(42) })
            navigation.addView(PlayerTheme.label(this, "SEU ENTRETENIMENTO"), LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) })
        }
        val navItems = LinearLayout(this).apply { orientation = if (wide) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL }
        for ((key, label) in choices) {
            val button = PlayerTheme.button(this, label) { navigate(key) }.apply { id = View.generateViewId(); gravity = Gravity.CENTER_VERTICAL or Gravity.START }
            menu[key] = button; navItems.addView(button, LinearLayout.LayoutParams(if (wide) -1 else -2, dp(49)).apply { if (wide) bottomMargin = dp(6) else marginEnd = dp(6) })
        }
        if (wide) {
            navigation.addView(navItems, LinearLayout.LayoutParams(-1, 0, 1f))
            navigation.addView(PlayerTheme.button(this, "Atualizar aplicativo") { updates() }, LinearLayout.LayoutParams(-1, dp(48)))
            navigation.addView(PlayerTheme.text(this, "v${BuildConfig.VERSION_NAME} · Android", 11f, PlayerTheme.muted).apply { setPadding(dp(8), dp(14), 0, dp(8)) })
            root.addView(navigation, LinearLayout.LayoutParams(dp(202), -1))
        } else { navigation.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(navItems) }); root.addView(navigation, LinearLayout.LayoutParams(-1, -2)) }
        val content = PlayerTheme.column(this, if (wide) 24 else 16)
        val header = PlayerTheme.row(this)
        val titles = PlayerTheme.column(this); titles.addView(PlayerTheme.label(this, "HIGH PASS / SUA BIBLIOTECA")); heading = PlayerTheme.text(this, "Início", if (wide) 28f else 24f, bold = true).apply { setPadding(0, dp(7), 0, 0) }; titles.addView(heading)
        header.addView(titles, LinearLayout.LayoutParams(0, -2, 1f)); clock = PlayerTheme.text(this, "", 12f, PlayerTheme.muted); if (wide) header.addView(clock)
        content.addView(header, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
        connection = PlayerTheme.text(this, "Verificando conexão…", 11f, PlayerTheme.muted); content.addView(connection, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) })
        body = PlayerTheme.column(this); content.addView(body, LinearLayout.LayoutParams(-1, 0, 1f)); root.addView(content, LinearLayout.LayoutParams(if (wide) 0 else -1, if (wide) -1 else 0, 1f))
        PlayerTheme.edgeToEdge(this, root); setContentView(root); navigate("home")
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() { if (section != "home") navigate("home") else moveTaskToBack(true) } })
        lifecycleScope.launch {
            try { account = api.json("account"); store.read()?.let { store.save(it.put("account", account)) }; connection.text = "● Engine conectada  ·  P2P automático com HTTP de contingência"; connection.setTextColor(PlayerTheme.accent) }
            catch (failure: Exception) { if (failure is CancellationException) throw failure; if (failure is ApiFailure && failure.status == 401) logout() else { connection.text = "Sem conexão com a engine · tente recarregar"; connection.setTextColor(PlayerTheme.warning) } }
        }
        lifecycleScope.launch {
            val pending = listOf("live", "movie", "series").map { kind -> async { kind to runCatching { api.json("catalog?kind=$kind&limit=1").getInt("total") }.getOrNull() } }
            for (item in pending) { val (key, count) = item.await(); if (count != null) { counts[key] = count; countLabels[key]?.text = "$count títulos na sua biblioteca" } }
        }
    }
    override fun onStart() { super.onStart(); handler.post(tick) }
    override fun onStop() { handler.removeCallbacks(tick); super.onStop() }
    override fun onResume() { super.onResume(); if (::body.isInitialized) { if (section == "home") renderHome() else if (section == "favorites") showRows(library.favorites()) } }
    private fun navigate(value: String) {
        loadJob?.cancel(); categoryJob?.cancel(); searchJob?.cancel(); previewJob?.cancel(); section = value; query = ""; category = ""; page = 0; rows = emptyList(); previewItem = null
        menu.forEach { (key, button) -> button.background = PlayerTheme.focus(this, key == value) }; heading.text = choices.first { it.first == value }.second
        body.removeAllViews(); previewTitle = null; previewGuide = null; previewImage = null
        when (value) { "home" -> renderHome(); "settings" -> renderSettings(); "account" -> renderAccount(); else -> renderLibrary() }
    }
    private fun renderHome() {
        body.removeAllViews(); countLabels.clear()
        val scroll = ScrollView(this); val home = PlayerTheme.column(this)
        val hero = PlayerTheme.column(this, 24).apply { background = PlayerTheme.shape(this@HomeActivity, PlayerTheme.elevated) }
        hero.addView(PlayerTheme.label(this, "BEM-VINDO, ${account.optString("username")}")); hero.addView(PlayerTheme.text(this, "Sua programação.\nDo seu jeito.", if (wide) 35f else 28f, bold = true).apply { setPadding(0, dp(14), 0, dp(12)) })
        hero.addView(PlayerTheme.text(this, "Ao vivo, filmes e séries em uma experiência feita para sua tela.", 15f, PlayerTheme.muted)); home.addView(hero)
        val tiles = LinearLayout(this).apply { orientation = if (wide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL }
        for ((key, label, eyebrow) in listOf(Triple("live", "Canais ao vivo", "AO VIVO"), Triple("movie", "Filmes", "CINEMA"), Triple("series", "Séries", "MARATONE"))) {
            val tile = PlayerTheme.column(this, 20).apply { background = PlayerTheme.focus(this@HomeActivity); isFocusable = true; isClickable = true; contentDescription = "Abrir $label"; setOnClickListener { navigate(key) } }
            tile.addView(PlayerTheme.label(this, eyebrow)); tile.addView(PlayerTheme.text(this, label, 23f, bold = true).apply { setPadding(0, dp(15), 0, dp(12)) })
            val count = PlayerTheme.text(this, counts[key]?.let { "$it títulos na sua biblioteca" } ?: "Explore sua biblioteca", 12f, PlayerTheme.muted); countLabels[key] = count; tile.addView(count)
            tiles.addView(tile, LinearLayout.LayoutParams(if (wide) 0 else -1, dp(144), if (wide) 1f else 0f).apply { topMargin = dp(16); marginEnd = if (wide) dp(12) else 0 })
        }
        home.addView(tiles)
        library.last()?.let { last -> home.addView(PlayerTheme.button(this, "Continuar assistindo · ${last.optString("name")}") { open(last) }, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(18) }) }
        val shortcuts = PlayerTheme.row(this); shortcuts.addView(PlayerTheme.button(this, "♥  ${library.favorites().size} favoritos") { navigate("favorites") }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginEnd = dp(10) }); shortcuts.addView(PlayerTheme.button(this, "Atualizar aplicativo") { updates() }, LinearLayout.LayoutParams(0, dp(50), 1f)); home.addView(shortcuts, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) }); scroll.addView(home); body.addView(scroll, LinearLayout.LayoutParams(-1, -1))
    }
    private fun renderLibrary() {
        val tools = PlayerTheme.row(this)
        search = EditText(this).apply { hint = "Encontre seu próximo play"; contentDescription = "Buscar na biblioteca"; isSingleLine = true; setTextColor(PlayerTheme.text); setHintTextColor(PlayerTheme.muted); background = PlayerTheme.focus(this@HomeActivity); setPadding(dp(14), 0, dp(14), 0); textSize = 14f; imeOptions = EditorInfo.IME_ACTION_SEARCH; id = View.generateViewId() }
        search.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEARCH) { (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(search.windowToken, 0); if (::catalog.isInitialized) catalog.requestFocus(); true } else false
        }
        tools.addView(search, LinearLayout.LayoutParams(0, dp(48), 1f)); body.addView(tools)
        val categories = Spinner(this).apply { id = View.generateViewId(); background = PlayerTheme.focus(this@HomeActivity); contentDescription = "Categoria"; setPadding(dp(8), 0, dp(8), 0) }
        if (section != "favorites") { tools.addView(categories, LinearLayout.LayoutParams(if (wide) dp(230) else dp(126), dp(48)).apply { marginStart = dp(10) }); loadCategories(categories) }
        counter = PlayerTheme.text(this, "Carregando programação…", 12f, PlayerTheme.muted).apply { setPadding(0, dp(12), 0, dp(12)) }; body.addView(counter)
        val area = PlayerTheme.row(this); val frame = FrameLayout(this)
        catalog = if (section == "live") ListView(this).apply { dividerHeight = dp(8); divider = android.graphics.drawable.ColorDrawable(PlayerTheme.background) } else GridView(this).apply { numColumns = if (!wide) 2 else if (resources.configuration.screenWidthDp >= 1150) 4 else 3; horizontalSpacing = dp(12); verticalSpacing = dp(12); stretchMode = GridView.STRETCH_COLUMN_WIDTH }
        catalog.id = View.generateViewId(); catalog.selector = PlayerTheme.focus(this); catalog.isFocusable = true; catalog.nextFocusUpId = search.id; catalog.nextFocusLeftId = menu[section]?.id ?: View.NO_ID
        menu.values.forEach { it.nextFocusRightId = catalog.id }; search.nextFocusDownId = catalog.id
        frame.addView(catalog, FrameLayout.LayoutParams(-1, -1)); val empty = PlayerTheme.text(this, "Nenhum título nesta seleção.", 15f, PlayerTheme.muted).apply { gravity = Gravity.CENTER }; frame.addView(empty, FrameLayout.LayoutParams(-1, -1)); catalog.emptyView = empty
        area.addView(frame, LinearLayout.LayoutParams(0, -1, 1f)); body.addView(area, LinearLayout.LayoutParams(-1, 0, 1f))
        if (section == "live" && wide) {
            val preview = PlayerTheme.column(this, 20).apply { background = PlayerTheme.shape(this@HomeActivity) }; preview.addView(PlayerTheme.label(this, "NA SUA TELA · AO VIVO"))
            val art = FrameLayout(this).apply { background = PlayerTheme.shape(this@HomeActivity, PlayerTheme.background); clipToOutline = true }
            art.addView(PlayerTheme.text(this, "▶", 48f, PlayerTheme.accent).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(-1, -1)); previewImage = ImageView(this).apply { scaleType = ImageView.ScaleType.FIT_CENTER }; art.addView(previewImage, FrameLayout.LayoutParams(-1, -1)); preview.addView(art, LinearLayout.LayoutParams(-1, dp(148)).apply { topMargin = dp(16) })
            previewTitle = PlayerTheme.text(this, "Escolha um canal", 23f, bold = true).apply { setPadding(0, dp(16), 0, dp(12)); maxLines = 2 }; preview.addView(previewTitle)
            preview.addView(PlayerTheme.button(this, "Assistir agora", true) { previewItem?.let { open(it) } }, LinearLayout.LayoutParams(-1, dp(48)))
            previewGuide = PlayerTheme.text(this, "Selecione um canal para consultar o guia de programação.", 13f, PlayerTheme.muted).apply { setPadding(0, dp(16), 0, 0); maxLines = 8 }; preview.addView(previewGuide)
            area.addView(preview, LinearLayout.LayoutParams(0, -1, 1.1f).apply { marginStart = dp(18) })
        }
        catalog.setOnItemClickListener { _, _, position, _ -> rows.getOrNull(position)?.let { open(it) } }
        catalog.setOnItemLongClickListener { _, _, position, _ -> rows.getOrNull(position)?.let { toggleFavorite(it) }; true }
        catalog.onItemSelectedListener = object : AdapterView.OnItemSelectedListener { override fun onNothingSelected(parent: AdapterView<*>?) {} ; override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { if (section == "live") rows.getOrNull(position)?.let { preview(it) } } }
        catalog.setOnKeyListener { _, code, event -> if (event.action == KeyEvent.ACTION_DOWN && code == KeyEvent.KEYCODE_MENU) { rows.getOrNull(catalog.selectedItemPosition.coerceAtLeast(0))?.let { toggleFavorite(it) }; true } else false }
        search.addTextChangedListener(object : android.text.TextWatcher { override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}; override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { searchJob?.cancel(); searchJob = lifecycleScope.launch { delay(350); query = s?.toString().orEmpty(); page = 0; if (section == "favorites") showRows(library.favorites().filter { it.optString("name").contains(query, true) }) else loadCatalog() } }; override fun afterTextChanged(value: android.text.Editable?) {} })
        val footer = PlayerTheme.row(this); footer.addView(PlayerTheme.button(this, "← Anterior") { if (page > 0) { page--; loadCatalog() } }); footer.addView(PlayerTheme.text(this, "MENU / segure para favoritar", 11f, PlayerTheme.muted).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, -2, 1f)); footer.addView(PlayerTheme.button(this, "Próxima →") { if ((page + 1) * 100 < total) { page++; loadCatalog() } }); body.addView(footer, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) })
        if (section == "favorites") showRows(library.favorites()) else loadCatalog()
    }
    private fun loadCategories(spinner: Spinner) {
        val selectedSection = section
        categoryJob = lifecycleScope.launch {
            try { val values = api.array("categories?kind=$selectedSection").objects(); val options = listOf("Todas as categorias") + values.map { it.optString("name") }
                if (section != selectedSection) return@launch
                spinner.adapter = ArrayAdapter(this@HomeActivity, android.R.layout.simple_spinner_dropdown_item, options)
                spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener { override fun onNothingSelected(parent: AdapterView<*>?) {}; override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { val next = if (position == 0) "" else values[position - 1].optString("id"); if (next != category) { category = next; page = 0; loadCatalog() } } }
            } catch (error: Exception) { if (error is CancellationException) throw error }
        }
    }
    private fun loadCatalog() {
        if (section !in listOf("live", "movie", "series")) return
        loadJob?.cancel(); counter.text = "Carregando programação…"; val selectedSection = section
        loadJob = lifecycleScope.launch {
            try { val result = api.json("catalog?kind=$selectedSection&limit=100&offset=${page * 100}&search=${URLEncoder.encode(query, "UTF-8")}&category=${URLEncoder.encode(category, "UTF-8")}"); if (section != selectedSection) return@launch; total = result.optInt("total"); showRows(result.getJSONArray("items").objects()); counter.text = "$total títulos · página ${page + 1}" }
            catch (failure: Exception) { if (failure is CancellationException) throw failure; counter.text = failure.message; if (failure is ApiFailure && failure.status == 401) logout() }
        }
    }
    private fun showRows(values: List<JSONObject>) {
        rows = values; val favoriteIds = library.favorites().map { "${it.optString("kind")}:${it.optString("id")}" }.toSet()
        val adapter = CatalogAdapter(this, values, section != "live", artwork, favoriteIds)
        if (catalog is GridView) (catalog as GridView).adapter = adapter else (catalog as ListView).adapter = adapter
        counter.text = "${values.size} títulos"; if (section == "live") values.firstOrNull()?.let { preview(it) }
    }
    private fun preview(item: JSONObject) {
        previewItem = item; previewTitle?.text = item.optString("name"); previewImage?.let { artwork.load(it, item) }; previewGuide?.text = "Consultando guia de programação…"; previewJob?.cancel()
        if (!wide) return
        previewJob = lifecycleScope.launch { delay(300); try { val epg = api.array("epg/${item.getString("id")}").objects(); previewGuide?.text = if (epg.isEmpty()) "Guia não disponibilizado pela operadora." else "GUIA DE PROGRAMAÇÃO\n\n" + epg.take(3).joinToString("\n\n") { "${it.optString("start").takeLast(8).take(5)}  ${it.optString("title")}" } } catch (error: Exception) { if (error is CancellationException) throw error; previewGuide?.text = "Guia temporariamente indisponível." } }
    }
    private fun open(item: JSONObject) {
        if (item.optString("kind") == "movie" || item.optString("kind") == "series") { startActivity(Intent(this, DetailsActivity::class.java).putExtra("item", item.toString())); return }
        loadJob?.cancel(); loadJob = lifecycleScope.launch {
            try { val request = JSONObject().put("kind", item.optString("kind", "live")).put("id", item.getString("id")); item.optString("seriesId").takeIf { it.isNotEmpty() }?.let { request.put("seriesId", it) }; val playback = api.json("playback", "POST", request); library.remember(item, item.optLong("positionMs")); startActivity(Intent(this@HomeActivity, PlayerActivity::class.java).putExtra("playback", playback.toString()).putExtra("item", item.toString()).putExtra("title", item.optString("name"))) }
            catch (error: Exception) { if (error is CancellationException) throw error; Toast.makeText(this@HomeActivity, error.message ?: "Conteúdo indisponível", Toast.LENGTH_LONG).show() }
        }
    }
    private fun toggleFavorite(item: JSONObject) { val saved = library.toggle(item); Toast.makeText(this, if (saved) "Adicionado aos favoritos" else "Removido dos favoritos", Toast.LENGTH_SHORT).show(); if (section == "favorites") showRows(library.favorites()) else showRows(rows) }
    private fun renderSettings() {
        val scroll = ScrollView(this); val content = PlayerTheme.column(this)
        fun card(title: String, description: String, button: String, action: () -> Unit) { val panel = PlayerTheme.column(this, 20).apply { background = PlayerTheme.shape(this@HomeActivity) }; panel.addView(PlayerTheme.text(this, title, 20f, bold = true)); panel.addView(PlayerTheme.text(this, description, 14f, PlayerTheme.muted).apply { setPadding(0, dp(12), 0, dp(16)) }); panel.addView(PlayerTheme.button(this, button, action = action)); content.addView(panel, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(14) }) }
        card("Atualização do aplicativo", "Versão instalada ${BuildConfig.VERSION_NAME}. Consulte novidades e instale sem perder seu login ou favoritos.", "Verificar atualizações") { updates() }
        card("P2P e qualidade de conexão", "P2P priorizado para os segmentos disponíveis. HTTP mantém a reprodução durante falhas, com recuperação automática. As taxas e os peers reais aparecem no player.", "Recarregar biblioteca") { navigate("live") }
        card("Miniaturas e capas", "Imagens carregadas sob demanda com cache limitado. Limpar miniaturas não remove sua conta nem os favoritos.", "Limpar miniaturas") { artwork.clear(); Toast.makeText(this, "Cache de miniaturas limpo", Toast.LENGTH_SHORT).show() }
        scroll.addView(content); body.addView(scroll, LinearLayout.LayoutParams(-1, -1))
    }
    private fun renderAccount() {
        val panel = PlayerTheme.column(this, 24).apply { background = PlayerTheme.shape(this@HomeActivity) }
        panel.addView(PlayerTheme.label(this, "SUA ASSINATURA")); panel.addView(PlayerTheme.text(this, "Olá, ${account.optString("username")}.", 30f, bold = true).apply { setPadding(0, dp(18), 0, dp(24)) })
        panel.addView(PlayerTheme.text(this, "Sessão válida até ${DateFormat.getDateTimeInstance().format(Date(account.optLong("expiresAt")))}\n\nConexões da linha: ${account.optInt("maxConnections")}\n\nDispositivo: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}\nHighpass Play ${BuildConfig.VERSION_NAME}", 16f, PlayerTheme.muted))
        panel.addView(PlayerTheme.button(this, "Encerrar sessão") { lifecycleScope.launch { runCatching { api.request("logout", "POST") }; logout() } }, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(30) }); body.addView(panel)
    }
    private fun updates() = startActivity(Intent(this, UpdateActivity::class.java))
    private fun logout() { store.clear(); startActivity(Intent(this, LoginActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)); finish() }
}
