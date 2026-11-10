package com.eduardoarce.kitchenbot.printer.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Plain JUnit — no Android, no printer. Pins the ESC/POS `DLE EOT` status bit
 * parsing and, critically, the safety contract: an unknown/silent printer is
 * NEVER reported as a fault (that would block printing on hardware that simply
 * doesn't answer the query). Status bytes carry the fixed pattern bit0=0,bit1=1
 * so the low nibble of each example below is 0x_2.
 */
class PrinterStatusTest {

    // DLE EOT 1: bit3 (0x08) = offline. Base valid byte = 0x12 (online).
    @Test fun `printer byte reports online and offline`() {
        assertTrue(PrinterStatus.parse(0x12, null, null).online == true)
        assertTrue(PrinterStatus.parse(0x12 or 0x08, null, null).online == false)
    }

    // DLE EOT 2: bit2 (0x04) = cover open, bit6 (0x40) = error.
    @Test fun `offline byte reports cover open and error`() {
        val s = PrinterStatus.parse(null, 0x12 or 0x04 or 0x40, null)
        assertTrue(s.coverOpen == true)
        assertTrue(s.error == true)
    }

    // DLE EOT 4: bits5,6 (0x60) = paper out, bits2,3 (0x0C) = near-end.
    @Test fun `paper byte reports out and near-end separately`() {
        val out = PrinterStatus.parse(null, null, 0x12 or 0x60)
        assertTrue(out.paperOut == true)
        val near = PrinterStatus.parse(null, null, 0x12 or 0x0C)
        assertTrue(near.paperNearEnd == true)
        assertFalse(near.paperOut == true)
    }

    // A byte failing the fixed-bit check (bit1 not set) is discarded as unknown,
    // not misread as a status — a stray print-ack byte can't fake "paper out".
    @Test fun `invalid fixed-bit byte is treated as no reply`() {
        val s = PrinterStatus.parse(0xFF, 0x00, 0x60) // none have bit0=0,bit1=1
        assertNull(s.online)
        assertNull(s.coverOpen)
        assertNull(s.paperOut)
        assertFalse(s.hadReply)
    }

    // The whole safety point: no reply ⇒ no problem reported ⇒ print is trusted.
    @Test fun `unknown printer reports no problem`() {
        assertNull(PrinterStatus.UNKNOWN.problem())
        assertNull(PrinterStatus.parse(null, null, null).problem())
        assertFalse(PrinterStatus.UNKNOWN.hadReply)
    }

    // A healthy printer that DID answer also reports no problem.
    @Test fun `healthy printer reports no problem`() {
        val s = PrinterStatus.parse(0x12, 0x12, 0x12)
        assertTrue(s.hadReply)
        assertNull(s.problem())
    }

    // Problem priority: paper-out wins over cover, error, offline.
    @Test fun `problem is prioritised by severity`() {
        val paper = PrinterStatus.parse(0x12 or 0x08, 0x12 or 0x04, 0x12 or 0x60)
        assertEquals(
            "Printer is out of paper. Reload the roll, then tap Retry.",
            paper.problem()
        )
        val cover = PrinterStatus.parse(null, 0x12 or 0x04, 0x12)
        assertTrue(cover.problem()!!.contains("cover is open"))
        val offline = PrinterStatus.parse(0x12 or 0x08, 0x12, 0x12)
        assertTrue(offline.problem()!!.contains("offline"))
    }

    // Near-end is not a blocking problem — it still prints.
    @Test fun `paper near-end is not reported as a problem`() {
        assertNull(PrinterStatus.parse(0x12, 0x12, 0x12 or 0x0C).problem())
    }
}
