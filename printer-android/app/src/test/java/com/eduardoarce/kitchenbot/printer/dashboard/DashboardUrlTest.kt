package com.eduardoarce.kitchenbot.printer.dashboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DashboardUrlTest {

    @Test
    fun `explicit dashboard url wins and is returned as-is when it has a scheme`() {
        val url = DashboardUrl.resolve(dashboardUrl = "http://192.168.1.50:8080/board", baseUrl = "http://192.168.1.50:3000")
        assertEquals("http://192.168.1.50:8080/board", url)
    }

    @Test
    fun `explicit dashboard url without a scheme gets http prefixed`() {
        assertEquals("http://board.local/kds", DashboardUrl.resolve("board.local/kds", ""))
    }

    @Test
    fun `https dashboard url is preserved`() {
        assertEquals("https://kds.example.com", DashboardUrl.resolve("https://kds.example.com", ""))
    }

    @Test
    fun `blank dashboard url defaults to the API host on control interface kitchen tab`() {
        assertEquals("http://192.168.1.50:9119/#kitchen-dashboard", DashboardUrl.resolve("", "http://192.168.1.50:3000"))
    }

    @Test
    fun `default handles a trailing slash and a missing scheme on the base url`() {
        assertEquals("http://10.0.0.9:9119/#kitchen-dashboard", DashboardUrl.resolve("", "http://10.0.0.9:3000/"))
        assertEquals("http://10.0.0.9:9119/#kitchen-dashboard", DashboardUrl.resolve("", "10.0.0.9:3000"))
    }

    @Test
    fun `both blank yields null (nothing to open)`() {
        assertNull(DashboardUrl.resolve(dashboardUrl = "", baseUrl = ""))
        assertNull(DashboardUrl.resolve(dashboardUrl = "   ", baseUrl = "   "))
    }
}
