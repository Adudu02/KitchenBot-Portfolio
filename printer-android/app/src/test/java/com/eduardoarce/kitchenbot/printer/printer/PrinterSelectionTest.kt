package com.eduardoarce.kitchenbot.printer.printer

import com.eduardoarce.kitchenbot.printer.api.BluetoothDeviceDto
import org.junit.Assert.assertEquals
import org.junit.Test

class PrinterSelectionTest {

    @Test
    fun defaultPrinterMacSelectsGlprinterByName() {
        val devices = listOf(
            BluetoothDeviceDto(name = "Speaker", address = "00:00:00:00:00:01"),
            BluetoothDeviceDto(name = "GLPrinter", address = "AB:0A:FC:26:0A:F2")
        )

        assertEquals("AB:0A:FC:26:0A:F2", defaultPrinterMac(devices))
    }

    @Test
    fun applyRemotePrinterSelectionKeepsCurrentWhenRemoteIsBlank() {
        assertEquals("AA:BB", applyRemotePrinterSelection("AA:BB", " "))
    }
}
