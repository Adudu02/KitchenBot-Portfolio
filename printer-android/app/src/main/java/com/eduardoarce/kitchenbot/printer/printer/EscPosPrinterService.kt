package com.eduardoarce.kitchenbot.printer.printer

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import com.dantsu.escposprinter.EscPosCharsetEncoding
import com.dantsu.escposprinter.EscPosPrinter
import com.dantsu.escposprinter.connection.DeviceConnection
import com.dantsu.escposprinter.textparser.PrinterTextParserImg

/**
 * Wraps the DantSu library for printing. Takes an already-connected
 * [DeviceConnection] opened by [BluetoothRepository.runJob] for this one job;
 * it does NOT open or close the socket — the repository closes it afterwards.
 *
 * Parameters default to [PrinterConfig] (203 dpi, 80mm roll, 48 chars/line,
 * CP437 charset). Change printer settings there, not here.
 *
 * Logo bitmaps are processed HERE (data layer, off the main thread), never in a
 * composable: decode → downscale to the dot width → 1-bit threshold → center →
 * slice tall images → emit DantSu <img> markup.
 */
class EscPosPrinterService(
    private val printerDpi: Int = PrinterConfig.DPI,
    private val printerWidthMm: Float = PrinterConfig.WIDTH_MM,
    private val charsPerLine: Int = PrinterConfig.CHARS_PER_LINE,
    private val charset: EscPosCharsetEncoding = PrinterConfig.charsetEncoding()
) {
    private val dotWidth = charsPerLine * PrinterConfig.DOTS_PER_CHAR


    /**
     * Formats [receipt] (logo first, if any) and prints it, then feeds and cuts —
     * printFormattedTextAndCut appends the feed + GS V cut automatically.
     * Must be called off the main thread (I/O). Throws on failure.
     */
    fun print(connection: DeviceConnection, receipt: Receipt, style: PrintStyle = PrintStyle()) {
        val printer = EscPosPrinter(connection, printerDpi, printerWidthMm, charsPerLine, charset)
        val logo = logoMarkup(printer, receipt.logoPath)
        val body = ReceiptFormatter.format(
            receipt = receipt,
            charsPerLine = charsPerLine,
            style = style,
            hasVisibleLogo = logo.isNotBlank()
        )
        printer.printFormattedTextAndCut(composeMarkup(logo, body))
        connection.write(POST_PRINT_FEED)
        connection.send(POST_PRINT_BUFFER_WAIT_MS)
    }

    /**
     * Standalone paper cut: feed a few lines FIRST, then send the partial-cut
     * command, or the cutter slices through the last printed line
     * (docs/02-Architecture.md §3). Must be called off the main thread.
     */
    fun cut(connection: DeviceConnection) {
        connection.write(FEED_5_LINES)
        connection.write(PARTIAL_CUT)
        connection.send(BUFFER_WAIT_MS)
    }

    /**
     * DantSu <img> markup for the logo — one centered <img> line per horizontal
     * slice (tall bitmaps overflow the buffer on cheap printers). Empty when
     * there's no logo or it can't be decoded.
     */
    private fun logoMarkup(printer: EscPosPrinter, logoPath: String?): String {
        if (logoPath == null) return ""
        val source = LogoImages.decodeForWidth(logoPath, dotWidth) ?: return ""
        return processLogo(source).joinToString("") { slice ->
            "[C]<img>" + PrinterTextParserImg.bitmapToHexadecimalString(printer, slice) + "</img>\n"
        }
    }

    /** Downscale → 1-bit black/white → center on full width → split into slices. */
    private fun processLogo(source: Bitmap): List<Bitmap> {
        val size = LogoScaling.scaledSize(source.width, source.height, dotWidth)
        val scaled = if (size.width == source.width && size.height == source.height) {
            source
        } else {
            Bitmap.createScaledBitmap(source, size.width, size.height, true)
        }
        val mono = toMonochromeCentered(scaled, dotWidth)
        var top = 0
        return LogoScaling.sliceHeights(mono.height, PrinterConfig.MAX_LOGO_SLICE_HEIGHT).map { h ->
            Bitmap.createBitmap(mono, 0, top, dotWidth, h).also { top += h }
        }
    }

    /** Threshold each pixel to pure black/white and center on a [dotWidth]-wide white canvas. */
    private fun toMonochromeCentered(src: Bitmap, dotWidth: Int): Bitmap {
        val out = Bitmap.createBitmap(dotWidth, src.height, Bitmap.Config.ARGB_8888)
        Canvas(out).drawColor(Color.WHITE)
        val xOffset = (dotWidth - src.width) / 2
        for (y in 0 until src.height) {
            for (x in 0 until src.width) {
                val pixel = src.getPixel(x, y)
                val luminance = if (Color.alpha(pixel) < ALPHA_THRESHOLD) {
                    255 // treat transparent as white
                } else {
                    (0.299 * Color.red(pixel) + 0.587 * Color.green(pixel) + 0.114 * Color.blue(pixel)).toInt()
                }
                out.setPixel(xOffset + x, y, if (luminance < MONO_THRESHOLD) Color.BLACK else Color.WHITE)
            }
        }
        return out
    }

    companion object {
        /**
         * Number of blank lines fed before the logo/header on every ticket.
         *
         * Neither [ReceiptFormatter.format] nor [logoMarkup] emit any leading
         * blank line — the header (or logo) is the very first printable line. On
         * its own, the only thing keeping that line off the paper's torn/cut edge
         * is the printer's mechanical print-head → cutter gap plus the *previous*
         * job's pre-cut feed — both implicit, and both absent on the first print
         * after power-on or after a manual tear. This small explicit top margin
         * guarantees the header never starts at the torn edge.
         */
        const val TOP_FEED_LINES = 2

        /** The explicit top margin as DantSu markup: [TOP_FEED_LINES] blank lines. */
        val TOP_FEED = "\n".repeat(TOP_FEED_LINES)

        /**
         * Assemble the final markup for one job: the explicit [TOP_FEED] margin,
         * then the logo, then the formatted receipt body. Kept pure (strings only,
         * no DantSu/Android) so the top-spacing contract is unit-testable and
         * [ReceiptFormatter] stays untouched — its golden output is byte-identical.
         */
        internal fun composeMarkup(logoMarkup: String, formattedBody: String): String =
            TOP_FEED + logoMarkup + formattedBody

        /** ESC d 5 — feed 5 lines before cutting. */
        val FEED_5_LINES = byteArrayOf(0x1B, 0x64, 0x05)

        /** GS V 66 0 — partial cut. */
        val PARTIAL_CUT = byteArrayOf(0x1D, 0x56, 0x42, 0x00)

        /** Give the print buffer time to flush before the cut lands (~100ms). */
        const val BUFFER_WAIT_MS = 100

        /** Feed once after the cut command to force one final ESC/POS write. */
        val POST_PRINT_FEED = byteArrayOf(0x1B, 0x64, 0x01)

        /** Cheap Bluetooth SPP printers can acknowledge writes before paper moves. */
        const val POST_PRINT_BUFFER_WAIT_MS = 1_800

        /** Luminance below this prints as black; alpha below this counts as transparent. */
        const val MONO_THRESHOLD = 128
        const val ALPHA_THRESHOLD = 128

        fun forPaperSize(paperSize: PaperSize): EscPosPrinterService =
            EscPosPrinterService(
                printerWidthMm = paperSize.widthMm,
                charsPerLine = paperSize.charsPerLine
            )
    }
}
