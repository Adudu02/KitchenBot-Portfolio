package com.eduardoarce.kitchenbot.printer.printer

import java.util.Locale

/**
 * Turns a [Receipt] into either:
 *  - [format]: the DantSu formatted-text markup ([C]/[L]/[R], <b>, <font>) that
 *    is sent to the printer, or
 *  - [previewText]: a plain monospace rendering justified to the printer's
 *    chars-per-line, for the on-screen preview.
 *
 * Both are pure (no Android, no DantSu) so the receipt-formatting logic can be
 * covered by plain JUnit tests without any hardware.
 *
 * [PrintStyle] is applied HERE at format time — stored text is never mutated, so
 * the uppercase toggle is fully reversible.
 */
object ReceiptFormatter {

    /** 80mm roll → 48 chars/line. Sourced from [PrinterConfig] (single config point). */
    val DEFAULT_CHARS_PER_LINE = PrinterConfig.CHARS_PER_LINE

    /** DantSu markup for actual printing. */
    fun format(
        receipt: Receipt,
        charsPerLine: Int = DEFAULT_CHARS_PER_LINE,
        style: PrintStyle = PrintStyle(),
        hasVisibleLogo: Boolean = receipt.logoPath != null
    ): String {
        val divider = "-".repeat(charsPerLine)
        // Wrap column content in the size tag (null for NORMAL → no tag, so the
        // NORMAL golden output is byte-identical to before).
        val sizeAttr = fontSizeAttr(style.fontSize)
        fun sized(content: String): String =
            if (sizeAttr == null) content else "<font size='$sizeAttr'>$content</font>"
        fun cased(text: String): String = applyCase(text, style)

        // DantSu's [L]…[R] column math multiplies double-width glyphs by 2 when
        // computing padding (PrinterTextParserString.length()), so right-alignment
        // stays correct for WIDE/BIG without any manual padding here.
        return buildList {
            if (receipt.header.isNotBlank()) add("[C]${sized("<b>${cased(receipt.header)}</b>")}")
            receipt.headerLines.filter { it.isNotBlank() }.forEach { add("[C]${sized(cased(it))}") }
            // Top divider only when there is a header block to separate from the body.
            if (hasHeader(receipt, hasVisibleLogo)) add("[C]$divider")
            // Operational order line — left-aligned, above the items.
            if (receipt.orderLine.isNotBlank()) add("[L]${sized(cased(receipt.orderLine))}")
            receipt.items.forEach { item ->
                add("[L]${sized("${item.qty}x ${cased(item.name)}")}[R]${sized(money(item.amount))}")
            }
            add("[C]$divider")
            add("[L]${sized("<b>TOTAL</b>")}[R]${sized("<b>${money(receipt.total)}</b>")}")
            if (receipt.footer.isNotBlank()) {
                add("[C]${sized(cased(receipt.footer))}")
            }
        }.joinToString("\n")
    }

    /**
     * Plain-text preview: every line is exactly the *effective* width wide,
     * headers/footers centered, item name left / price right — mirrors how the
     * printout justifies.
     *
     * Width trap: WIDE/BIG double glyph width, halving how many glyphs fit on the
     * paper (48 → 24). Justify at [effectiveWidth] so the preview proportions
     * match the paper for every font size.
     */
    fun previewText(
        receipt: Receipt,
        charsPerLine: Int = DEFAULT_CHARS_PER_LINE,
        style: PrintStyle = PrintStyle(),
        hasVisibleLogo: Boolean = receipt.logoPath != null
    ): String {
        val width = charsPerLine / widthMultiplier(style.fontSize)
        val divider = "-".repeat(width)
        fun cased(text: String): String = applyCase(text, style)
        return buildList {
            // Mirrors format(): collapse a blank/absent header so the preview
            // shows exactly what the paper will (no leading blank lines).
            if (receipt.header.isNotBlank()) add(center(cased(receipt.header), width))
            receipt.headerLines.filter { it.isNotBlank() }.forEach { add(center(cased(it), width)) }
            if (hasHeader(receipt, hasVisibleLogo)) add(divider)
            if (receipt.orderLine.isNotBlank()) add(justify(cased(receipt.orderLine), "", width))
            receipt.items.forEach { item ->
                add(justify("${item.qty}x ${cased(item.name)}", money(item.amount), width))
            }
            add(divider)
            add(justify("TOTAL", money(receipt.total), width))
            if (receipt.footer.isNotBlank()) {
                add(center(cased(receipt.footer), width))
            }
        }.joinToString("\n")
    }

    /**
     * Uppercases and strips diacritics CP437 can't render as uppercase (á→A,
     * é→E, ü→U …) while KEEPING Ñ and Ç, which CP437 does have. Pure and
     * reversible (operates on a copy) — the toggle never mutates stored text.
     */
    fun deaccentForUppercase(text: String): String {
        val upper = text.uppercase(Locale.ROOT) // á→Á, ñ→Ñ, deterministic
        val sb = StringBuilder(upper.length)
        for (c in upper) {
            sb.append(
                when (c) {
                    'Á', 'À', 'Â', 'Ä', 'Ã' -> 'A'
                    'É', 'È', 'Ê', 'Ë' -> 'E'
                    'Í', 'Ì', 'Î', 'Ï' -> 'I'
                    'Ó', 'Ò', 'Ô', 'Ö', 'Õ' -> 'O'
                    'Ú', 'Ù', 'Û', 'Ü' -> 'U'
                    else -> c // Ñ, Ç and everything else pass through
                }
            )
        }
        return sb.toString()
    }

    /** DantSu `<font size>` attribute for a [FontSize], or null for NORMAL (no tag). */
    private fun fontSizeAttr(fontSize: FontSize): String? = when (fontSize) {
        FontSize.NORMAL -> null
        FontSize.TALL -> "tall"
        FontSize.WIDE -> "wide"
        FontSize.BIG -> "big"
    }

    /** How many normal-char columns one glyph occupies horizontally. */
    private fun widthMultiplier(fontSize: FontSize): Int = when (fontSize) {
        FontSize.WIDE, FontSize.BIG -> 2 // double width
        FontSize.NORMAL, FontSize.TALL -> 1 // tall is double height only
    }

    private fun applyCase(text: String, style: PrintStyle): String =
        if (style.uppercase) deaccentForUppercase(text) else text

    /**
     * Whether the ticket has any header element — title, a non-blank header line,
     * or a logo. Drives the top divider in BOTH [format] and [previewText] so the
     * two stay mirrored: no header element ⇒ no divider, body starts at item 1.
     */
    private fun hasHeader(receipt: Receipt, hasVisibleLogo: Boolean): Boolean =
        receipt.header.isNotBlank() ||
            receipt.headerLines.any { it.isNotBlank() } ||
            hasVisibleLogo

    /** Fixed 2-decimal money, dot separator (Locale.US) so output is deterministic. */
    fun money(value: Double): String = String.format(Locale.US, "%.2f", value)

    /** Centers [text] within [width]; truncates if it's too long. */
    private fun center(text: String, width: Int): String {
        if (text.length >= width) return text.take(width)
        val padTotal = width - text.length
        val left = padTotal / 2
        return " ".repeat(left) + text + " ".repeat(padTotal - left)
    }

    /** Left text + right text padded to exactly [width]; truncates left if needed. */
    private fun justify(left: String, right: String, width: Int): String {
        val maxLeft = (width - right.length - 1).coerceAtLeast(0)
        val trimmedLeft = if (left.length > maxLeft) left.take(maxLeft) else left
        val gap = (width - trimmedLeft.length - right.length).coerceAtLeast(1)
        return trimmedLeft + " ".repeat(gap) + right
    }
}
