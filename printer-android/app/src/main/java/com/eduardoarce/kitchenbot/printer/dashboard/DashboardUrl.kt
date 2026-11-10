package com.eduardoarce.kitchenbot.printer.dashboard

import java.net.URI

/**
 * Resolves the kitchen dashboard URL to load. The dashboard is served by the
 * Control Interface, so when no explicit URL is set we default to the API host
 * on port 9119 and the Kitchen tab hash route.
 *
 * Pure (no Android) so the resolution rules are covered by plain JUnit tests.
 */
object DashboardUrl {

    /** Explicit [dashboardUrl] wins; otherwise [baseUrl]'s host on Control Interface. Null if neither is set. */
    fun resolve(dashboardUrl: String, baseUrl: String): String? {
        val explicit = dashboardUrl.trim()
        if (explicit.isNotEmpty()) {
            return normalize(explicit)
        }
        val base = baseUrl.trim().trimEnd('/')
        if (base.isEmpty()) {
            return null
        }
        val uri = URI(normalize(base))
        return "${uri.scheme}://${uri.host}:9119/#kitchen-dashboard"
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
