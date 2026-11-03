package com.highpass.player

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

object PlayerTheme {
    val background = Color.rgb(9, 15, 24)
    val sidebar = Color.rgb(14, 23, 36)
    val surface = Color.rgb(19, 31, 47)
    val elevated = Color.rgb(26, 42, 61)
    val accent = Color.rgb(100, 225, 182)
    val text = Color.rgb(238, 244, 252)
    val muted = Color.rgb(146, 165, 190)
    val border = Color.rgb(41, 60, 81)
    val warning = Color.rgb(255, 197, 132)
    fun dp(context: Context, value: Int) = (value * context.resources.displayMetrics.density).toInt()
    fun shape(context: Context, color: Int = surface, radius: Int = 14, stroke: Int = border, width: Int = 1) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(context, radius).toFloat(); setStroke(dp(context, width), stroke)
    }
    fun focus(context: Context, selected: Boolean = false) = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_focused), shape(context, Color.rgb(29, 66, 58), stroke = accent, width = 2))
        addState(intArrayOf(android.R.attr.state_pressed), shape(context, Color.rgb(29, 66, 58), stroke = accent, width = 2))
        addState(intArrayOf(android.R.attr.state_selected), shape(context, Color.rgb(23, 52, 47), stroke = accent))
        addState(intArrayOf(), shape(context, if (selected) Color.rgb(23, 52, 47) else surface, stroke = if (selected) accent else border))
    }
    fun text(context: Context, value: String, size: Float = 16f, color: Int = text, bold: Boolean = false) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color); if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        includeFontPadding = false
    }
    fun label(context: Context, value: String) = text(context, value.uppercase(java.util.Locale.getDefault()), 10f, muted, true).apply { letterSpacing = .16f }
    fun button(context: Context, value: String, primary: Boolean = false, action: () -> Unit) = Button(context).apply {
        text = value; isAllCaps = false; textSize = 14f; minHeight = dp(context, 48); minimumWidth = 0
        setPadding(dp(context, 14), dp(context, 8), dp(context, 14), dp(context, 8))
        setTextColor(if (primary) PlayerTheme.background else PlayerTheme.text)
        background = if (primary) StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), shape(context, Color.WHITE, stroke = accent, width = 3))
            addState(intArrayOf(), shape(context, accent, stroke = accent))
        } else focus(context)
        isFocusable = true; setOnClickListener { action() }
    }
    fun column(context: Context, padding: Int = 0) = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL; if (padding > 0) setPadding(dp(context, padding), dp(context, padding), dp(context, padding), dp(context, padding))
    }
    fun row(context: Context) = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    fun edgeToEdge(activity: Activity, root: View, padding: Int = 0) {
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()); val gap = dp(activity, padding)
            view.setPadding(bars.left + gap, bars.top + gap, bars.right + gap, bars.bottom + gap); insets
        }
    }
    fun playerWindow(activity: Activity, root: View, fullscreen: Boolean) {
        val controller = WindowCompat.getInsetsController(activity.window, root)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (fullscreen) {
            WindowCompat.setDecorFitsSystemWindows(activity.window, false)
            ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets -> view.setPadding(0, 0, 0, 0); insets }
            root.setPadding(0, 0, 0, 0)
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            edgeToEdge(activity, root)
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
        ViewCompat.requestApplyInsets(root)
    }
    fun brand(context: Context) = column(context).apply {
        addView(text(context, "H  HIGH PASS", 21f, accent, true))
        addView(label(context, "PLAY · ${BuildConfig.TRANSPORT.uppercase()}").apply { setPadding(dp(context, 29), dp(context, 7), 0, 0) })
    }
}
