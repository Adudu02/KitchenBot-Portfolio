package com.eduardoarce.kitchenbot.printer.api

import com.eduardoarce.kitchenbot.printer.printer.ReceiptTemplate
import org.junit.Assert.assertEquals
import org.junit.Test

class OrderReceiptMapperTest {

    private val order = QueueOrderDto(
        id = "42",
        printKey = "42:3",
        status = "CONFIRMED",
        items = listOf(
            QueueItemDto(nameSnapshot = "Torta de asado", quantity = 2, unitPriceSnapshot = 45.0),
            QueueItemDto(nameSnapshot = "Agua", quantity = 1, unitPriceSnapshot = 15.5)
        )
    )

    @Test
    fun `maps order onto receipt model using template`() {
        val template = ReceiptTemplate(
            headerTitle = "Cocina Norte",
            headerLine1 = "Av. Siempre Viva 123",
            footer = "Gracias"
        )

        val receipt = OrderReceiptMapper.toReceipt(order, template)

        assertEquals("Cocina Norte", receipt.header)
        assertEquals(listOf("Av. Siempre Viva 123"), receipt.headerLines)
        assertEquals("Pedido #42", receipt.orderLine)
        assertEquals(2, receipt.items.size)
        assertEquals("Torta de asado", receipt.items[0].name)
        assertEquals(2, receipt.items[0].qty)
        assertEquals(45.0, receipt.items[0].price, 0.001)
        // Footer is the template footer alone — no printKey in printed output.
        assertEquals("Gracias", receipt.footer)
        assertEquals(105.5, receipt.total, 0.001)
    }

    @Test
    fun `blank header title stays blank (no PEDIDO fallback)`() {
        val receipt = OrderReceiptMapper.toReceipt(order, ReceiptTemplate(headerTitle = ""))
        assertEquals("", receipt.header)
    }

    @Test
    fun `blank template gives empty header lines and the order line stays operational`() {
        val receipt = OrderReceiptMapper.toReceipt(order, ReceiptTemplate())
        assertEquals(emptyList<String>(), receipt.headerLines)
        assertEquals("Pedido #42", receipt.orderLine)
    }

    @Test
    fun `footer is blank when template footer blank (printKey not printed)`() {
        val receipt = OrderReceiptMapper.toReceipt(order, ReceiptTemplate(footer = ""))
        assertEquals("", receipt.footer)
    }

    @Test
    fun `template logo path flows onto the receipt`() {
        val receipt = OrderReceiptMapper.toReceipt(
            order,
            ReceiptTemplate(logoPath = "/data/logo.img")
        )
        assertEquals("/data/logo.img", receipt.logoPath)
    }

    @Test
    fun `blank item names become placeholder`() {
        val receipt = OrderReceiptMapper.toReceipt(
            order.copy(items = listOf(QueueItemDto(nameSnapshot = "", quantity = 1, unitPriceSnapshot = 1.0))),
            ReceiptTemplate(headerTitle = "X")
        )
        assertEquals("Producto", receipt.items[0].name)
    }
}
