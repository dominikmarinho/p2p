package com.highpass.player

import java.io.ByteArrayOutputStream

class SegmentBuffer(private val maxBytes: Int = 16 * 1024 * 1024) {
    private val data = ByteArrayOutputStream()
    @Synchronized fun append(bytes: ByteArray) {
        require(bytes.size <= maxBytes - data.size()) { "Segmento acima do limite" }
        data.write(bytes)
    }
    @Synchronized fun bytes(): ByteArray = data.toByteArray()
}
