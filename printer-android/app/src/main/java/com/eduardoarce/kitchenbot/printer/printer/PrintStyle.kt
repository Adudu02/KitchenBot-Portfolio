package com.eduardoarce.kitchenbot.printer.printer

/**
 * Print-style options carried inside a [ReceiptTemplate]. Pure data — the
 * formatter (Task 2) decides how to render these; nothing here touches Android.
 *
 * NOTE: only the shape is introduced in Task 0 (so the template can persist it).
 * The actual application to [ReceiptFormatter] output lands in Task 2.
 */
enum class FontSize {
    /** No size markup. */
    NORMAL,

    /** DantSu `<font size='tall'>` — double height. */
    TALL,

    /** DantSu `<font size='wide'>` — double width. */
    WIDE,

    /** DantSu `<font size='big'>` — double height and width. */
    BIG
}

enum class PaperSize(
    val widthMm: Float,
    val charsPerLine: Int
) {
    /** 58mm roll, typically 48mm printable width and 32 normal chars per line. */
    MM58(widthMm = 48f, charsPerLine = 32),

    /** 80mm roll, 72mm printable width and 48 normal chars per line. */
    MM80(widthMm = 72f, charsPerLine = 48);

    val dotWidth: Int get() = charsPerLine * PrinterConfig.DOTS_PER_CHAR
}

data class PrintStyle(
    val fontSize: FontSize = FontSize.NORMAL,
    val uppercase: Boolean = false,
    val paperSize: PaperSize = PaperSize.MM80
)
