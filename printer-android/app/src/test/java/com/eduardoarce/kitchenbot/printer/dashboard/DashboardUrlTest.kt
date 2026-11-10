package com.eduardoarce.kitchenbot.printer.dashboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DashboardUrlTest {

    @Test
    fun `explicit dashboard url is returned as-is when it has a scheme`() {
        assertEquals("http://192.168.1.50:8080/board", DashboardUrl.resolve("http://192.168.1.50:8080/board"))
    }

    @Test
    fun `explicit dashboard url without a scheme gets http prefixed`() {
        assertEquals("http://board.local/kds", DashboardUrl.resolve("board.local/kds"))
    }

    @Test
    fun `https dashboard url is preserved`() {
        assertEquals("https://kds.example.com", DashboardUrl.resolve("https://kds.example.com"))
    }

    @Test
    fun `surrounding whitespace is trimmed`() {
        assertEquals("http://board.local/kds", DashboardUrl.resolve("  board.local/kds  "))
    }

    @Test
    fun `blank dashboard url yields null and is never derived from anything else`() {
        assertNull(DashboardUrl.resolve(""))
        assertNull(DashboardUrl.resolve("   "))
    }
}
