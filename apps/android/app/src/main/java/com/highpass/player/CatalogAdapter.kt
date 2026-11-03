package com.highpass.player

import android.content.Context
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AbsListView
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

class CatalogAdapter(private val context: Context, private val items: List<JSONObject>, private val posters: Boolean, private val artwork: ArtworkLoader, private val favoriteIds: Set<String> = emptySet()) : BaseAdapter() {
    private data class Holder(val image: ImageView, val placeholder: TextView, val title: TextView, val caption: TextView)
    override fun getCount() = items.size
    override fun getItem(position: Int) = items[position]
    override fun getItemId(position: Int) = position.toLong()
    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val root: LinearLayout; val holder: Holder
        if (convertView == null) {
            root = LinearLayout(context).apply { orientation = if (posters) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; background = PlayerTheme.shape(context); setPadding(PlayerTheme.dp(context, 10), PlayerTheme.dp(context, 10), PlayerTheme.dp(context, 10), PlayerTheme.dp(context, 10)); layoutParams = AbsListView.LayoutParams(-1, PlayerTheme.dp(context, if (posters) 250 else 74)) }
            val art = FrameLayout(context).apply { background = PlayerTheme.shape(context, PlayerTheme.elevated, 8); clipToOutline = true }
            val placeholder = PlayerTheme.text(context, "", if (posters) 40f else 18f, PlayerTheme.accent, true).apply { gravity = Gravity.CENTER }
            val image = ImageView(context).apply { scaleType = if (posters) ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER }
            art.addView(placeholder, FrameLayout.LayoutParams(-1, -1)); art.addView(image, FrameLayout.LayoutParams(-1, -1))
            root.addView(art, LinearLayout.LayoutParams(if (posters) -1 else PlayerTheme.dp(context, 54), PlayerTheme.dp(context, if (posters) 178 else 48)))
            val info = PlayerTheme.column(context).apply { setPadding(if (posters) 0 else PlayerTheme.dp(context, 12), if (posters) PlayerTheme.dp(context, 10) else 0, 0, 0) }
            val title = PlayerTheme.text(context, "", 14f, bold = true).apply { maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
            val caption = PlayerTheme.text(context, "", 10f, PlayerTheme.muted).apply { setPadding(0, PlayerTheme.dp(context, 5), 0, 0) }
            info.addView(title); info.addView(caption); root.addView(info, LinearLayout.LayoutParams(if (posters) -1 else 0, -2, if (posters) 0f else 1f))
            holder = Holder(image, placeholder, title, caption); root.tag = holder
        } else { root = convertView as LinearLayout; holder = root.tag as Holder }
        val item = items[position]; val favorite = "${item.optString("kind")}:${item.optString("id")}" in favoriteIds
        holder.title.text = item.optString("name"); holder.placeholder.text = item.optString("name").take(2).uppercase()
        holder.caption.text = (if (favorite) "♥  " else "") + when (item.optString("kind")) { "movie" -> "FILME · SOB DEMANDA"; "series" -> "SÉRIE · EPISÓDIOS"; "episode" -> "TEMPORADA ${item.optString("season")}"; else -> "${(position + 1).toString().padStart(3, '0')}  ·  AO VIVO" }
        root.contentDescription = item.optString("name"); artwork.load(holder.image, item); return root
    }
}
