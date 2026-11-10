package com.eduardoarce.kitchenbot.printer.dashboard

/**
 * Resolves the optional web dashboard URL to load. The URL is used only when it
 * is set explicitly; there is no derived default.
 *
 * Pure (no Android) so the resolution rules are covered by plain JUnit tests.
 */
object DashboardUrl {

    /** The normalised [dashboardUrl], or null when it is blank (nothing to open). */
    fun resolve(dashboardUrl: String): String? {
        val explicit = dashboardUrl.trim()
        return if (explicit.isEmpty()) null else normalize(explicit)
    }

    /** Prefix a bare host/URL with http:// so it's a valid, loadable URI. */
    private fun normalize(url: String): String {
        val trimmed = url.trim()
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else {
            "http://$trimmed"
        }
    }
}
