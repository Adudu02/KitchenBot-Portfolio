package com.eduardoarce.kitchenbot.printer.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Plain JUnit — no Android, no device. Pins the top-spacing contract of the
 * print pipeline: the logo/header must never be the very first printable line,
 * so it can't land on the paper's torn/cut edge. The margin is added in
 * [EscPosPrinterService.composeMarkup], NOT in [ReceiptFormatter] (which stays
 * pure and byte-identical — see `format produces the expected markup`).
 */
class EscPosPrinterServiceTest {

    private val body = ReceiptFormatter.format(
        Receipt(
            header = "MY STORE",
            items = listOf(LineItem("Coffee", 1, 3.50)),
            footer = "Thanks"
        )
    )

    @Test
    fun `top feed is a small fixed number of blank lines`() {
        assertEquals(2, EscPosPrinterService.TOP_FEED_LINES)
        assertEquals("\n\n", EscPosPrinterService.TOP_FEED)
    }

    @Test
    fun `composed markup starts with the top feed, then the header`() {
        val markup = EscPosPrinterService.composeMarkup(logoMarkup = "", formattedBody = body)

        assertEquals(EscPosPrinterService.TOP_FEED + body, markup)
        // Two blank lines precede the first printable line…
        assertTrue("markup must start with the top feed", markup.startsWith("\n\n"))
        // …and that first printable line is the header, not the torn edge.
        assertEquals("[C]<b>MY STORE</b>", markup.substringAfter("\n\n").substringBefore("\n"))
    }

    @Test
    fun `top feed precedes the logo when there is one`() {
        val logo = "[C]<img>deadbeef</img>\n"
        val markup = EscPosPrinterService.composeMarkup(logoMarkup = logo, formattedBody = body)

        assertEquals(EscPosPrinterService.TOP_FEED + logo + body, markup)
        // The logo image comes strictly after the feed — never at position 0.
        assertTrue(markup.indexOf("<img>") >= EscPosPrinterService.TOP_FEED.length)
    }

    @Test
    fun `ReceiptFormatter stays pure - body has no leading blank line`() {
        // The margin lives only in the service; the formatted body itself still
        // begins with the header so the golden tests remain byte-identical.
        assertFalse("formatter must not add its own top feed", body.startsWith("\n"))
        assertTrue(body.startsWith("[C]<b>MY STORE</b>"))
    }
}
