package com.eduardoarce.kitchenbot.printer.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Plain JUnit — no Android, no device. Verifies the receipt-formatting logic
 * that turns a Receipt into DantSu markup.
 */
class ReceiptFormatterTest {

    private val sample = Receipt(
        header = "MY STORE",
        items = listOf(
            LineItem("Coffee", 1, 3.50),
            LineItem("Bagel", 2, 2.00)
        ),
        footer = "Thank you!"
    )

    @Test
    fun `total is the sum of line amounts`() {
        // 1×3.50 + 2×2.00 = 7.50
        assertEquals(7.50, sample.total, 0.0001)
    }

    @Test
    fun `line amount multiplies qty by price`() {
        assertEquals(4.00, LineItem("Bagel", 2, 2.00).amount, 0.0001)
    }

    @Test
    fun `money formats to two decimals with a dot`() {
        assertEquals("3.50", ReceiptFormatter.money(3.5))
        assertEquals("2.00", ReceiptFormatter.money(2.0))
        assertEquals("10.00", ReceiptFormatter.money(9.999))
    }

    @Test
    fun `format produces the expected markup`() {
        val divider = "-".repeat(48)
        val expected = listOf(
            "[C]<b>MY STORE</b>",
            "[C]$divider",
            "[L]1x Coffee[R]3.50",
            "[L]2x Bagel[R]4.00",
            "[C]$divider",
            "[L]<b>TOTAL</b>[R]<b>7.50</b>",
            "[C]Thank you!"
        ).joinToString("\n")

        assertEquals(expected, ReceiptFormatter.format(sample))
    }

    @Test
    fun `divider width matches chars per line`() {
        val out = ReceiptFormatter.format(sample, charsPerLine = 32)
        val dividerLine = out.lines().first { it == "[C]" + "-".repeat(32) }
        // Strip the [C] tag → exactly 32 dashes.
        assertEquals(32, dividerLine.removePrefix("[C]").length)
    }

    @Test
    fun `paper size maps to expected receipt widths`() {
        assertEquals(32, PaperSize.MM58.charsPerLine)
        assertEquals(48, PaperSize.MM80.charsPerLine)

        val mm58 = ReceiptFormatter.previewText(
            sample,
            charsPerLine = PaperSize.MM58.charsPerLine,
            style = PrintStyle(paperSize = PaperSize.MM58)
        )
        val mm80 = ReceiptFormatter.previewText(
            sample,
            charsPerLine = PaperSize.MM80.charsPerLine,
            style = PrintStyle(paperSize = PaperSize.MM80)
        )

        assertEquals(32, mm58.lines().first().length)
        assertEquals(48, mm80.lines().first().length)
    }

    @Test
    fun `blank header and no header lines - first line is an item, no leading blank or divider`() {
        val headerless = sample.copy(header = "", headerLines = emptyList(), logoPath = null)
        val out = ReceiptFormatter.format(headerless)
        // First printed line is the first item — no [C]<b></b> and no top divider.
        assertEquals("[L]1x Coffee[R]3.50", out.lines().first())
        assertTrue("no empty bold header line", !out.contains("[C]<b></b>"))
        // Only one divider remains (the pre-TOTAL one).
        assertEquals(1, out.lines().count { it == "[C]" + "-".repeat(48) })
    }

    @Test
    fun `blank header but one header line still emits the top divider`() {
        val out = ReceiptFormatter.format(
            sample.copy(header = "", headerLines = listOf("Av. Siempre Viva 123"))
        )
        val expected = listOf(
            "[C]Av. Siempre Viva 123",
            "[C]" + "-".repeat(48),
            "[L]1x Coffee[R]3.50",
            "[L]2x Bagel[R]4.00",
            "[C]" + "-".repeat(48),
            "[L]<b>TOTAL</b>[R]<b>7.50</b>",
            "[C]Thank you!"
        ).joinToString("\n")
        assertEquals(expected, out)
    }

    @Test
    fun `blank header with logo but no header lines still emits the top divider`() {
        val out = ReceiptFormatter.format(
            sample.copy(header = "", headerLines = emptyList(), logoPath = "/data/logo.img")
        )
        // Logo counts as a header element → two dividers (top + pre-TOTAL).
        assertEquals(2, out.lines().count { it == "[C]" + "-".repeat(48) })
        assertEquals("[C]" + "-".repeat(48), out.lines().first())
    }

    @Test
    fun `blank header with stale logo path but no rendered logo omits the top divider`() {
        val out = ReceiptFormatter.format(
            sample.copy(header = "", headerLines = emptyList(), logoPath = "/data/missing.img"),
            hasVisibleLogo = false
        )
        assertEquals("[L]1x Coffee[R]3.50", out.lines().first())
        assertEquals(1, out.lines().count { it == "[C]" + "-".repeat(48) })
    }

    @Test
    fun `blank header lines are dropped individually`() {
        val out = ReceiptFormatter.format(
            sample.copy(header = "MY STORE", headerLines = listOf("", "Phone 555"))
        )
        assertTrue("keeps the non-blank line", out.contains("[C]Phone 555"))
        assertTrue("no empty header line", !out.contains("[C]\n"))
    }

    @Test
    fun `order line with blank header is the first line, left-aligned, no divider`() {
        val out = ReceiptFormatter.format(
            sample.copy(header = "", headerLines = emptyList(), logoPath = null, orderLine = "Pedido #7")
        )
        // First line is the operational order line, left-aligned — no centered
        // header, no orphan divider above it.
        assertEquals("[L]Pedido #7", out.lines().first())
        assertEquals(1, out.lines().count { it == "[C]" + "-".repeat(48) })
    }

    @Test
    fun `order line prints after the header divider when a header exists`() {
        val out = ReceiptFormatter.format(
            sample.copy(header = "MY STORE", orderLine = "Pedido #7")
        )
        val lines = out.lines()
        assertEquals("[C]<b>MY STORE</b>", lines[0])
        assertEquals("[C]" + "-".repeat(48), lines[1])
        assertEquals("[L]Pedido #7", lines[2])
    }

    @Test
    fun `preview order line is left-aligned above the items`() {
        val out = ReceiptFormatter.previewText(
            sample.copy(header = "", headerLines = emptyList(), logoPath = null, orderLine = "Pedido #7"),
            charsPerLine = 48
        )
        val first = out.lines().first()
        assertTrue("left-aligned", first.startsWith("Pedido #7"))
        assertEquals(48, first.length)
        // No divider above it.
        assertTrue(out.lines()[1].trimStart().startsWith("1x Coffee"))
    }

    @Test
    fun `blank footer is omitted`() {
        val noFooter = sample.copy(footer = "")
        val out = ReceiptFormatter.format(noFooter)
        assertTrue("Should not contain a footer line", !out.contains("Thank you!"))
        // Last line is the total, not an empty [C] line.
        assertEquals("[L]<b>TOTAL</b>[R]<b>7.50</b>", out.lines().last())
    }

    // --- previewText (plain monospace, justified to chars-per-line) ---

    @Test
    fun `preview lines are all exactly chars-per-line wide`() {
        ReceiptFormatter.previewText(sample, charsPerLine = 48).lines().forEach {
            assertEquals("Line not padded to width: '$it'", 48, it.length)
        }
    }

    @Test
    fun `preview justifies item name left and price right`() {
        val line = ReceiptFormatter.previewText(sample, charsPerLine = 48)
            .lines().first { it.trimStart().startsWith("1x Coffee") }
        assertTrue("name on the left", line.startsWith("1x Coffee"))
        assertTrue("price on the right", line.endsWith("3.50"))
        assertEquals(48, line.length)
    }

    @Test
    fun `preview centers the header`() {
        val header = ReceiptFormatter.previewText(sample, charsPerLine = 48).lines().first()
        assertEquals("MY STORE", header.trim())
        // Roughly centered: leading padding within one space of trailing.
        val leading = header.takeWhile { it == ' ' }.length
        val trailing = header.takeLastWhile { it == ' ' }.length
        assertTrue("centered", kotlin.math.abs(leading - trailing) <= 1)
    }

    @Test
    fun `preview mirrors format - blank header starts at the first item, no divider`() {
        val headerless = sample.copy(header = "", headerLines = emptyList(), logoPath = null)
        val out = ReceiptFormatter.previewText(headerless, charsPerLine = 48)
        val first = out.lines().first()
        assertTrue("first line is the item", first.trimStart().startsWith("1x Coffee"))
        // Single divider (pre-TOTAL); no top divider.
        assertEquals(1, out.lines().count { it == "-".repeat(48) })
    }

    @Test
    fun `preview blank header with one header line keeps the top divider`() {
        val out = ReceiptFormatter.previewText(
            sample.copy(header = "", headerLines = listOf("Av. Siempre Viva 123")),
            charsPerLine = 48
        )
        assertEquals("Av. Siempre Viva 123", out.lines().first().trim())
        assertEquals("-".repeat(48), out.lines()[1])
    }

    @Test
    fun `preview blank header with stale logo path but no rendered logo omits the top divider`() {
        val out = ReceiptFormatter.previewText(
            sample.copy(header = "", headerLines = emptyList(), logoPath = "/data/missing.img"),
            charsPerLine = 48,
            hasVisibleLogo = false
        )
        assertTrue(out.lines().first().trimStart().startsWith("1x Coffee"))
        assertEquals(1, out.lines().count { it == "-".repeat(48) })
    }

    @Test
    fun `preview total line shows computed total on the right`() {
        val out = ReceiptFormatter.previewText(sample, charsPerLine = 48)
        val totalLine = out.lines().first { it.startsWith("TOTAL") }
        assertTrue(totalLine.endsWith("7.50"))
    }

    // --- Task 2: PrintStyle (font size + uppercase) ---

    @Test
    fun `deaccentForUppercase uppercases and strips CP437-unrenderable accents`() {
        assertEquals("CAFE", ReceiptFormatter.deaccentForUppercase("café"))
        assertEquals("ARBOL", ReceiptFormatter.deaccentForUppercase("Árbol"))
        assertEquals("PINGUINO", ReceiptFormatter.deaccentForUppercase("pingüino"))
        // Ñ exists in CP437 → kept.
        assertEquals("SEÑOR", ReceiptFormatter.deaccentForUppercase("señor"))
        assertEquals("NIÑO", ReceiptFormatter.deaccentForUppercase("Niño"))
        // Ç exists in CP437 → kept.
        assertEquals("GARÇON", ReceiptFormatter.deaccentForUppercase("garçon"))
    }

    @Test
    fun `deaccentForUppercase does not mutate its input`() {
        val original = "café"
        ReceiptFormatter.deaccentForUppercase(original)
        assertEquals("café", original)
    }

    @Test
    fun `NORMAL style output is byte-identical to no style`() {
        assertEquals(
            ReceiptFormatter.format(sample),
            ReceiptFormatter.format(sample, style = PrintStyle(fontSize = FontSize.NORMAL, uppercase = false))
        )
    }

    @Test
    fun `format wraps every body line in the font tag for BIG`() {
        val out = ReceiptFormatter.format(sample, style = PrintStyle(fontSize = FontSize.BIG))
        val expected = listOf(
            "[C]<font size='big'><b>MY STORE</b></font>",
            "[C]" + "-".repeat(48),
            "[L]<font size='big'>1x Coffee</font>[R]<font size='big'>3.50</font>",
            "[L]<font size='big'>2x Bagel</font>[R]<font size='big'>4.00</font>",
            "[C]" + "-".repeat(48),
            "[L]<font size='big'><b>TOTAL</b></font>[R]<font size='big'><b>7.50</b></font>",
            "[C]<font size='big'>Thank you!</font>"
        ).joinToString("\n")
        assertEquals(expected, out)
    }

    @Test
    fun `format uses tall and wide attributes`() {
        assertTrue(
            ReceiptFormatter.format(sample, style = PrintStyle(fontSize = FontSize.TALL))
                .contains("<font size='tall'>")
        )
        assertTrue(
            ReceiptFormatter.format(sample, style = PrintStyle(fontSize = FontSize.WIDE))
                .contains("<font size='wide'>")
        )
    }

    @Test
    fun `format applies uppercase to header and body but not amounts`() {
        val accented = sample.copy(
            header = "café norte",
            headerLines = listOf("señor"),
            items = listOf(LineItem("piñón", 1, 3.50))
        )
        val out = ReceiptFormatter.format(accented, style = PrintStyle(uppercase = true))
        assertTrue(out.contains("[C]<b>CAFE NORTE</b>"))
        assertTrue(out.contains("[C]SEÑOR"))
        assertTrue(out.contains("[L]1x PIÑON[R]3.50"))
    }

    @Test
    fun `preview justifies at half width for WIDE`() {
        ReceiptFormatter.previewText(sample, charsPerLine = 48, style = PrintStyle(fontSize = FontSize.WIDE))
            .lines().forEach { assertEquals("WIDE preview line: '$it'", 24, it.length) }
    }

    @Test
    fun `preview justifies at half width for BIG but full for TALL and NORMAL`() {
        fun widthOf(fs: FontSize) =
            ReceiptFormatter.previewText(sample, charsPerLine = 48, style = PrintStyle(fontSize = fs))
                .lines().first().length
        assertEquals(24, widthOf(FontSize.BIG))
        assertEquals(48, widthOf(FontSize.TALL))
        assertEquals(48, widthOf(FontSize.NORMAL))
    }

    @Test
    fun `preview WIDE keeps item name left and price right at effective width`() {
        val line = ReceiptFormatter.previewText(sample, charsPerLine = 48, style = PrintStyle(fontSize = FontSize.WIDE))
            .lines().first { it.trimStart().startsWith("1x Coffee") }
        assertTrue("name on the left", line.startsWith("1x Coffee"))
        assertTrue("price on the right", line.endsWith("3.50"))
        assertEquals(24, line.length)
    }

    @Test
    fun `preview uppercases visible text`() {
        val out = ReceiptFormatter.previewText(
            sample.copy(header = "café"),
            charsPerLine = 48,
            style = PrintStyle(uppercase = true)
        )
        assertEquals("CAFE", out.lines().first().trim())
    }
}
