package com.eduardoarce.kitchenbot.printer.api

import com.eduardoarce.kitchenbot.printer.printer.LineItem
import com.eduardoarce.kitchenbot.printer.printer.Receipt
import com.eduardoarce.kitchenbot.printer.printer.ReceiptTemplate

/**
 * Maps a Kitchen API queue order onto the existing [Receipt] model — using the
 * shared [ReceiptTemplate] — so the formatting/printing pipeline
 * (ReceiptFormatter → EscPosPrinterService) can print it.
 *
 * The header comes straight from [ReceiptTemplate.headerTitle]: blank stays
 * blank (no "PEDIDO" fallback). The operational "Pedido #{id}" line is a
 * left-aligned [Receipt.orderLine] above the items — never a centered header
 * line — so a blank header collapses without an orphan divider.
 */
object OrderReceiptMapper {

    fun toReceipt(order: QueueOrderDto, template: ReceiptTemplate): Receipt = Receipt(
        header = template.headerTitle,
        headerLines = listOf(template.headerLine1, template.headerLine2)
            .filter { it.isNotBlank() },
        orderLine = "Pedido #${order.id}",
        items = order.items.map { item ->
            LineItem(
                name = item.nameSnapshot.ifBlank { "Producto" },
                qty = item.quantity,
                price = item.unitPriceSnapshot
            )
        },
        // Template footer alone — no printKey in the printed output. A blank
        // footer collapses in ReceiptFormatter exactly as before.
        footer = template.footer,
        logoPath = template.logoPath
    )
}
