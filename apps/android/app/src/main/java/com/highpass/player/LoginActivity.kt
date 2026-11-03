package com.highpass.player

import android.content.Intent
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject

class LoginActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)
        val container = (findViewById<android.view.View>(android.R.id.content) as android.view.ViewGroup).getChildAt(0) as ScrollView
        val form = (container.getChildAt(0) as LinearLayout).getChildAt(0)
        form.layoutParams.width = minOf((360 * resources.displayMetrics.density).toInt(), resources.displayMetrics.widthPixels - (80 * resources.displayMetrics.density).toInt())
        val username = findViewById<EditText>(R.id.username)
        val password = findViewById<EditText>(R.id.password)
        val button = findViewById<Button>(R.id.login)
        val error = findViewById<TextView>(R.id.error)
        val api = EngineApi(this); val store = SessionStore(this)
        fun openHome() { startActivity(Intent(this, HomeActivity::class.java)); finish() }
        button.setOnClickListener {
            if (username.text.isBlank() || password.text.isBlank()) { error.text = "Informe usuário e senha"; return@setOnClickListener }
            button.isEnabled = false; error.text = "Conectando…"
            lifecycleScope.launch {
                try {
                    val result = api.json("login", "POST", JSONObject().put("username", username.text.toString()).put("password", password.text.toString()))
                    store.save(result); password.text.clear(); openHome()
                } catch (failure: Exception) { error.text = failure.message ?: "Não foi possível entrar"; button.isEnabled = true }
            }
        }
        password.setOnEditorActionListener { _, actionId, _ -> if (actionId == EditorInfo.IME_ACTION_DONE) { button.performClick(); true } else false }
        username.requestFocus()
        if (store.token() != null) lifecycleScope.launch {
            try { api.json("account"); openHome() } catch (_: Exception) { store.clear() }
        }
    }
}
