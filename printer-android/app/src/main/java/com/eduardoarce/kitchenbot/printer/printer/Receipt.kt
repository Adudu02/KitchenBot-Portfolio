package com.eduardoarce.kitchenbot.printer.printer

/**
 * Pure data model for a receipt. No Android/DantSu dependencies, so the
 * formatting logic that consumes it stays unit-testable without a device.
 */
data class LineItem(
    val name: String,
    val qty: Int,
    val price: Double
) {
    /** Line subtotal: quantity × unit price. */
    val amount: Double get() = qty * price
}

data class Receipt(
    val header: String,
    val items: List<LineItem>,
    val footer: String = "",
    /** Up to 2 optional free-text header lines (e.g. address, phone), printed centered. */
    val headerLines: List<String> = emptyList(),
    /** Absolute path to the persisted logo image in filesDir, or null. Printed via <img>. */
    val logoPath: String? = null,
    /**
     * Operational line (e.g. "Pedido #123") printed LEFT-aligned immediately
     * above the items. It is NOT a header element: a blank header collapses fully
     * and this line — not a centered header — becomes the first line, with no
     * orphan divider above it.
     */
    val orderLine: String = ""
) {
    /** Auto-computed total — sum of all line amounts. */
    val total: Double get() = items.sumOf { it.amount }
}
