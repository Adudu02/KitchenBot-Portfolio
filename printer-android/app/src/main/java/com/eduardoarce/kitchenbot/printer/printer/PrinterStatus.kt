package com.eduardoarce.kitchenbot.printer.printer

/**
 * Physical printer state read back with the ESC/POS real-time status commands
 * (`DLE EOT n`). This is the "printer readback" the connect-per-job model in
 * [BluetoothRepository] could not do before: a fire-and-forget SPP write is
 * acked by the socket even when no paper moved, so the only way to know the
 * printer's real condition is to ask it and read the answer.
 *
 * Every field is nullable on purpose. `null` means "the printer did not give a
 * usable answer for that query" — either it doesn't implement `DLE EOT` (some
 * cheap units don't) or the reply was garbled. Callers must treat `null` as
 * *unknown*, never as *fine*: [problem] only reports a fault the printer
 * POSITIVELY confirmed, so an unknown printer is trusted rather than blocked.
 *
 * Pure (no Android, no I/O) so the bit parsing is unit-tested without hardware.
 */
data class PrinterStatus(
    val online: Boolean?,
    val coverOpen: Boolean?,
    val paperOut: Boolean?,
    val paperNearEnd: Boolean?,
    val error: Boolean?,
) {
    /** True if any query returned a usable status byte. */
    val hadReply: Boolean
        get() = listOf(online, coverOpen, paperOut, paperNearEnd, error).any { it != null }

    /**
     * A user-facing message for a positively-detected physical problem, or
     * `null` when the printer is fine OR did not answer. Ordered by how much it
     * blocks printing: no paper first, then cover, then a generic error, then
     * offline. Paper-near-end is intentionally NOT a problem — it still prints.
     */
    fun problem(): String? = when {
        paperOut == true -> "Printer is out of paper. Reload the roll, then tap Retry."
        coverOpen == true -> "Printer cover is open. Close it, then tap Retry."
        error == true -> "Printer reported an error. Check it, then tap Retry."
        online == false -> "Printer is offline. Turn it on, then tap Retry."
        else -> null
    }

    companion object {
        /** Nothing was read (printer unreachable, or answered nothing usable). */
        val UNKNOWN = PrinterStatus(null, null, null, null, null)

        /**
         * Parse the three real-time status bytes into a [PrinterStatus].
         *
         * @param printer reply to `DLE EOT 1` (printer status)
         * @param offline reply to `DLE EOT 2` (offline cause)
         * @param paper   reply to `DLE EOT 4` (paper-roll sensor)
         *
         * Any argument may be `null` (no reply). Each byte is validated against
         * the ESC/POS fixed-bit pattern — bit0 clear, bit1 set — so a stray
         * print-ack byte is not misread as a status; a byte failing that check
         * is discarded as `null`.
         */
        fun parse(printer: Int?, offline: Int?, paper: Int?): PrinterStatus {
            val p = valid(printer)
            val o = valid(offline)
            val r = valid(paper)
            return PrinterStatus(
                // DLE EOT 1, bit3 (0x08): 0 = online, 1 = offline.
                online = p?.let { it and 0x08 == 0 },
                // DLE EOT 2, bit2 (0x04): cover open. bit6 (0x40): error occurred.
                coverOpen = o?.let { it and 0x04 != 0 },
                error = o?.let { it and 0x40 != 0 },
                // DLE EOT 4, bits5,6 (0x60): paper end. bits2,3 (0x0C): near-end.
                paperOut = r?.let { it and 0x60 != 0 },
                paperNearEnd = r?.let { it and 0x0C != 0 },
            )
        }

        /** A real DLE EOT reply has bit0 = 0 and bit1 = 1; anything else is noise. */
        private fun valid(byte: Int?): Int? =
            if (byte != null && byte and 0x03 == 0x02) byte else null
    }
}
