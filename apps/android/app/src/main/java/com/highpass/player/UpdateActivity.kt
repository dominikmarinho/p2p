package com.highpass.player

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.File

class UpdateActivity : ComponentActivity() {
    private lateinit var message: TextView
    private lateinit var action: android.widget.Button
    private lateinit var progress: ProgressBar
    private var release: ClientRelease? = null
    private var apk: File? = null
    private var awaitingPermission = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = ScrollView(this).apply { setBackgroundColor(PlayerTheme.background); isFillViewport = true }
        val frame = PlayerTheme.column(this, 28).apply { gravity = Gravity.CENTER }
        val card = PlayerTheme.column(this, 28).apply { background = PlayerTheme.shape(this@UpdateActivity) }
        card.addView(PlayerTheme.brand(this)); card.addView(PlayerTheme.text(this, "Atualizações", 30f, bold = true).apply { setPadding(0, 28, 0, 16) })
        card.addView(PlayerTheme.text(this, "Instalado · versão ${BuildConfig.VERSION_NAME}", 15f, PlayerTheme.accent))
        message = PlayerTheme.text(this, "Consulte a versão mais recente do Highpass Play.", 16f, PlayerTheme.muted).apply { setPadding(0, 24, 0, 24) }; card.addView(message)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; visibility = android.view.View.GONE }; card.addView(progress, LinearLayout.LayoutParams(-1, PlayerTheme.dp(this, 8)))
        action = PlayerTheme.button(this, "Verificar atualizações", true) { if (apk != null) install() else if (release != null && release!!.versionCode > BuildConfig.VERSION_CODE) download() else check() }
        card.addView(action, LinearLayout.LayoutParams(-1, PlayerTheme.dp(this, 54)))
        card.addView(PlayerTheme.button(this, "Voltar") { finish() }, LinearLayout.LayoutParams(-1, PlayerTheme.dp(this, 54)).apply { topMargin = PlayerTheme.dp(this@UpdateActivity, 12) })
        frame.addView(card, LinearLayout.LayoutParams(minOf(PlayerTheme.dp(this, 560), resources.displayMetrics.widthPixels - PlayerTheme.dp(this, 40)), -2)); root.addView(frame)
        PlayerTheme.edgeToEdge(this, root); setContentView(root); action.requestFocus(); check()
    }
    private fun check() {
        action.isEnabled = false; message.text = "Verificando nova versão…"
        lifecycleScope.launch {
            try { release = AppUpdates(this@UpdateActivity).check(); val item = release!!
                if (item.versionCode > BuildConfig.VERSION_CODE) { message.text = "Nova versão ${item.versionName}\n\n${item.notes}\n\nDownload · ${"%.1f".format(item.size / 1048576.0)} MB\nO Android pedirá sua confirmação para instalar."; action.text = "Baixar atualização" }
                else { release = null; message.text = "Seu aplicativo está atualizado.\n\nVersão ${BuildConfig.VERSION_NAME} instalada."; action.text = "Verificar novamente" }
            } catch (error: Exception) { if (error is CancellationException) throw error; message.text = error.message ?: "Sem conexão com o servidor de atualizações"; action.text = "Tentar novamente" }
            finally { action.isEnabled = true }
        }
    }
    private fun download() {
        val item = release ?: return; action.isEnabled = false; progress.visibility = android.view.View.VISIBLE
        lifecycleScope.launch {
            try { apk = AppUpdates(this@UpdateActivity).download(item) { progress.progress = it; message.text = "Baixando versão ${item.versionName} · $it%" }; message.text = "Download verificado. Pronto para atualizar."; action.text = "Instalar atualização"; install() }
            catch (error: Exception) { if (error is CancellationException) throw error; message.text = error.message ?: "Não foi possível baixar a atualização"; action.text = "Baixar novamente" }
            finally { action.isEnabled = true; progress.visibility = android.view.View.GONE }
        }
    }
    private fun install() {
        val file = apk ?: return
        try {
            if (!packageManager.canRequestPackageInstalls()) { awaitingPermission = true; message.text = "Permita a instalação pelo Highpass Play na próxima tela. Depois volte para concluir a atualização."; startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))); return }
            val uri = FileProvider.getUriForFile(this, "$packageName.updates", file)
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            message.text = "Confirme a atualização na tela do Android. Seu login e seus favoritos serão mantidos."
        } catch (_: SecurityException) { message.text = "A instalação foi bloqueada pelo Android. Confira a permissão de instalar aplicativos nas configurações." } catch (_: ActivityNotFoundException) { message.text = "Este dispositivo não oferece um instalador. Instale o APK pelo gerenciador de arquivos da TV." }
    }
    override fun onResume() { super.onResume(); if (awaitingPermission) { awaitingPermission = false; if (packageManager.canRequestPackageInstalls()) install() } }
}
