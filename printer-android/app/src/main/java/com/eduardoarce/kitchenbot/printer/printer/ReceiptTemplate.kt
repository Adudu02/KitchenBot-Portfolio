package com.eduardoarce.kitchenbot.printer.printer

/**
 * The single persisted ticket template consumed by BOTH print paths (manual
 * "test print" and the auto-print queue). Pure data — no Android/DantSu — so the
 * mapping/formatting logic that consumes it stays unit-testable.
 *
 * [headerTitle] may be blank; blank means "no header on paper" (Task 1). The
 * logo bytes still live in [LogoStore]; the template only carries the path.
 */
data class ReceiptTemplate(
    /** Bold centered title; blank ⇒ header title line omitted on paper (Task 1). */
    val headerTitle: String = "",
    /** Optional centered free-text line (e.g. address). */
    val headerLine1: String = "",
    /** Optional centered free-text line (e.g. phone). */
    val headerLine2: String = "",
    /** Absolute path to the persisted logo image in filesDir, or null. */
    val logoPath: String? = null,
    /** Free-text footer; blank ⇒ no footer line. */
    val footer: String = "",
    /** Font size + uppercase options (applied in Task 2). */
    val style: PrintStyle = PrintStyle()
)
