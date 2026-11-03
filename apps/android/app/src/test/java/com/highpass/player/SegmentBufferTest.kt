package com.highpass.player

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SegmentBufferTest {
    @Test fun preservesBinarySegmentsAcrossBridgeChunks() {
        val expected = ByteArray(100000) { (it % 256).toByte() }
        val buffer = SegmentBuffer()
        for (chunk in expected.asList().chunked(32768)) buffer.append(chunk.toByteArray())
        assertArrayEquals(expected, buffer.bytes())
    }
    @Test fun rejectsOversizeWithoutCorruptingPriorBytes() {
        val buffer = SegmentBuffer(4)
        buffer.append(byteArrayOf(0, 1))
        assertThrows(IllegalArgumentException::class.java) { buffer.append(byteArrayOf(2, 3, 4)) }
        assertArrayEquals(byteArrayOf(0, 1), buffer.bytes())
    }
}
