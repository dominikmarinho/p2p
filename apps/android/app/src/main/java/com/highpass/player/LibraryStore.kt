package com.highpass.player

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class LibraryStore(context: Context, accountId: String) {
    private val preferences = context.getSharedPreferences("highpass-settings", Context.MODE_PRIVATE)
    private val key = "favorites:$accountId"
    private val historyKey = "continue:$accountId"
    fun favorites(): List<JSONObject> = runCatching { val array = JSONArray(preferences.getString(key, "[]")); (0 until array.length()).map { array.getJSONObject(it) } }.getOrDefault(emptyList())
    fun contains(item: JSONObject) = favorites().any { it.optString("id") == item.optString("id") && it.optString("kind") == item.optString("kind") }
    fun toggle(item: JSONObject): Boolean {
        val values = favorites().toMutableList(); val found = values.indexOfFirst { it.optString("id") == item.optString("id") && it.optString("kind") == item.optString("kind") }
        if (found >= 0) values.removeAt(found) else { if (values.size >= 500) values.removeAt(0); values.add(JSONObject(item.toString())) }
        preferences.edit().putString(key, JSONArray(values).toString()).apply(); return found < 0
    }
    fun last(): JSONObject? = runCatching { JSONObject(preferences.getString(historyKey, null) ?: return null) }.getOrNull()
    fun remember(item: JSONObject, position: Long = 0) { preferences.edit().putString(historyKey, JSONObject(item.toString()).put("positionMs", position).toString()).apply() }
}
