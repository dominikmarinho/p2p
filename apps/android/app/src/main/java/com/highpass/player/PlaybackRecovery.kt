package com.highpass.player

class PlaybackRecovery(private val now: () -> Long = { System.nanoTime() / 1_000_000 }) {
    private var lastProgress = now()
    private var position = 0L
    private var attempts = 0
    fun observe(at: Long, wanted: Boolean, ended: Boolean): Boolean {
        val advanced = kotlin.math.abs(at - position) > 100
        if (advanced || !wanted || ended) { lastProgress = now(); if (advanced) attempts = 0 }
        position = at
        return wanted && !ended && now() - lastProgress >= 35000
    }
    fun restarted() { lastProgress = now() }
    fun retryDelay(): Long { val delay = minOf(30000L, 3000L * (1L shl minOf(attempts, 4))); attempts = minOf(4, attempts + 1); return delay }
}
