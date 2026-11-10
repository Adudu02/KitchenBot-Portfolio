package com.eduardoarce.kitchenbot.printer.api

/**
 * A fixed sample order used by the receipt editor: it drives BOTH the live
 * preview and the "Test print" button through the REAL pipeline
 * (OrderReceiptMapper → ReceiptFormatter), so what you see is exactly what
 * auto-print will produce for a real order.
 */
object SampleOrder {
    val order = QueueOrderDto(
        id = "123",
        printKey = "123:1",
        status = "CONFIRMED",
        items = listOf(
            QueueItemDto(nameSnapshot = "Hamburguesa clásica", quantity = 2, unitPriceSnapshot = 120.0),
            QueueItemDto(nameSnapshot = "Papas fritas", quantity = 1, unitPriceSnapshot = 60.0),
            QueueItemDto(nameSnapshot = "Refresco", quantity = 2, unitPriceSnapshot = 35.0)
        )
    )
}
