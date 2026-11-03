package com.highpass.player

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

class LoginActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val wide = resources.configuration.screenWidthDp >= 700
        val root = ScrollView(this).apply { setBackgroundColor(PlayerTheme.background); isFillViewport = true }
        val layout = LinearLayout(this).apply { orientation = if (wide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(24), dp(30), dp(24), dp(30)) }
        if (wide) layout.addView(PlayerTheme.column(this, 28).apply {
            addView(PlayerTheme.brand(this@LoginActivity)); addView(PlayerTheme.label(this@LoginActivity, "SEU ENTRETENIMENTO, NA SUA TELA").apply { setPadding(0, dp(70), 0, dp(20)) })
            addView(PlayerTheme.text(this@LoginActivity, "O próximo play\ncomeça aqui.", 44f, bold = true))
            addView(PlayerTheme.text(this@LoginActivity, "Canais ao vivo, filmes e séries.\nUma experiência feita para sua TV.", 18f, PlayerTheme.muted).apply { setPadding(0, dp(24), 0, dp(36)) })
            addView(PlayerTheme.text(this@LoginActivity, "AO VIVO     •     FILMES     •     SÉRIES", 12f, PlayerTheme.accent))
        }, LinearLayout.LayoutParams(0, -2, 1f))
        val form = PlayerTheme.column(this, 28).apply { background = PlayerTheme.shape(this@LoginActivity) }
        if (!wide) form.addView(PlayerTheme.brand(this))
        form.addView(PlayerTheme.label(this, "HIGH PASS · ${BuildConfig.TRANSPORT.uppercase()}").apply { setPadding(0, dp(24), 0, dp(12)) }); form.addView(PlayerTheme.text(this, "É só dar o play.", 30f, bold = true))
        form.addView(PlayerTheme.text(this, "Entre com os dados da sua assinatura.", 14f, PlayerTheme.muted).apply { setPadding(0, dp(12), 0, dp(24)) })
        fun input(label: String, secret: Boolean) = EditText(this).apply {
            hint = label; contentDescription = label; isSingleLine = true; textSize = 16f; setTextColor(PlayerTheme.text); setHintTextColor(PlayerTheme.muted)
            inputType = if (secret) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_NORMAL
            background = PlayerTheme.focus(this@LoginActivity); setPadding(dp(16), 0, dp(16), 0); id = View.generateViewId(); imeOptions = if (secret) EditorInfo.IME_ACTION_DONE else EditorInfo.IME_ACTION_NEXT
            setAutofillHints(if (secret) View.AUTOFILL_HINT_PASSWORD else View.AUTOFILL_HINT_USERNAME)
        }
        val username = input("Usuário", false); val password = input("Senha", true)
        form.addView(username, LinearLayout.LayoutParams(-1, dp(54))); form.addView(password, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(12) })
        val error = PlayerTheme.text(this, "", 13f, PlayerTheme.warning).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        val api = EngineApi(this); val store = SessionStore(this)
        fun openHome() { startActivity(Intent(this, HomeActivity::class.java)); finish() }
        lateinit var login: android.widget.Button
        login = PlayerTheme.button(this, "Entrar e assistir", true) {
            if (username.text.isBlank() || password.text.isBlank()) error.text = "Informe usuário e senha"
            else { login.isEnabled = false; error.text = "Conectando à sua programação…"
                lifecycleScope.launch {
                    try { val result = api.json("login", "POST", JSONObject().put("username", username.text.toString().trim()).put("password", password.text.toString())); store.save(result); password.text.clear(); openHome() }
                    catch (failure: Exception) { if (failure is CancellationException) throw failure; error.text = failure.message ?: "Não foi possível entrar"; login.isEnabled = true }
                }
            }
        }
        login.id = View.generateViewId(); username.nextFocusDownId = password.id; password.nextFocusDownId = login.id
        form.addView(login, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(22) }); form.addView(error, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) })
        form.addView(PlayerTheme.button(this, "Verificar atualizações · v${BuildConfig.VERSION_NAME}") { startActivity(Intent(this, UpdateActivity::class.java)) }, LinearLayout.LayoutParams(-1, dp(50)).apply { topMargin = dp(18) })
        layout.addView(form, LinearLayout.LayoutParams(minOf(dp(410), resources.displayMetrics.widthPixels - dp(48)), -2)); root.addView(layout)
        PlayerTheme.edgeToEdge(this, root); setContentView(root); username.requestFocus()
        password.setOnEditorActionListener { _, action, _ -> if (action == EditorInfo.IME_ACTION_DONE) { login.performClick(); true } else false }
        if (store.token() != null) lifecycleScope.launch {
            try { val account = api.json("account"); store.read()?.let { store.save(it.put("account", account)) }; openHome() }
            catch (failure: Exception) { if (failure is CancellationException) throw failure; if (failure is ApiFailure && failure.status == 401) store.clear(); error.text = "Entre para continuar ou verifique sua conexão." }
        }
    }
    private fun dp(value: Int) = PlayerTheme.dp(this, value)
}
