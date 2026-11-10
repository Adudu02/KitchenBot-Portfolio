package com.eduardoarce.kitchenbot.printer.printer

import com.eduardoarce.kitchenbot.printer.api.BluetoothDeviceDto

fun defaultPrinterMac(devices: List<BluetoothDeviceDto>): String =
    devices.firstOrNull { it.name.contains("GLPrinter", ignoreCase = true) }?.address.orEmpty()

fun applyRemotePrinterSelection(currentMac: String, remoteMac: String?): String {
    val remote = remoteMac?.trim().orEmpty()
    return if (remote.isNotBlank() && !remote.equals(currentMac, ignoreCase = true)) remote else currentMac
}
