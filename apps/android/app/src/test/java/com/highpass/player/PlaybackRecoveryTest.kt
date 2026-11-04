package com.highpass.player

import org.junit.Assert.*
import org.junit.Test

class PlaybackRecoveryTest {
    @Test fun detectsStallAndRespectsPauseAndEnd() {
        var now = 0L; val recovery = PlaybackRecovery { now }
        assertFalse(recovery.observe(1000, true, false)); now = 35001
        assertTrue(recovery.observe(1000, true, false))
        assertFalse(recovery.observe(1000, false, false)); now += 40000
        assertFalse(recovery.observe(1000, false, false)); assertFalse(recovery.observe(1000, true, true))
        recovery.restarted(); assertFalse(recovery.observe(1000, true, false))
    }
    @Test fun boundsRetriesAndResetsAfterActualProgress() {
        val recovery = PlaybackRecovery { 0L }
        assertEquals(listOf(3000L, 6000L, 12000L, 24000L, 30000L, 30000L), List(6) { recovery.retryDelay() })
        recovery.observe(2000, true, false); assertEquals(3000L, recovery.retryDelay())
    }
}
