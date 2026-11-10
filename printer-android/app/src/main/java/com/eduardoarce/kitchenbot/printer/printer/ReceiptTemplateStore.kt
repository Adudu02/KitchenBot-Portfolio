package com.eduardoarce.kitchenbot.printer.printer

import android.content.Context
import androidx.datastore.core.DataMigration
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.eduardoarce.kitchenbot.printer.api.ApiSettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val HEADER_TITLE_KEY = stringPreferencesKey("header_title")

/**
 * One-time upgrade: existing installs stored the ticket header as
 * ApiSettings.kitchenName. Seed the template's header title from it (once, while
 * the key is still absent) so upgraders don't silently lose their header.
 */
private class KitchenNameToHeaderTitleMigration(
    private val context: Context
) : DataMigration<Preferences> {

    override suspend fun shouldMigrate(currentData: Preferences): Boolean =
        !currentData.contains(HEADER_TITLE_KEY)

    override suspend fun migrate(currentData: Preferences): Preferences {
        val kitchenName = runCatching { ApiSettingsStore(context).kitchenNameForMigration() }
            .getOrDefault("")
        // Always write the key (blank for fresh installs) so the migration is
        // one-shot; provisioning still seeds a blank header title afterwards.
        return currentData.toMutablePreferences().apply {
            set(HEADER_TITLE_KEY, kitchenName.trim())
        }
    }

    override suspend fun cleanUp() = Unit
}

private val Context.receiptTemplateDataStore by preferencesDataStore(
    name = "receipt_template",
    produceMigrations = { context -> listOf(KitchenNameToHeaderTitleMigration(context)) }
)

/**
 * Persists the single [ReceiptTemplate] shared by both print paths, following
 * the same DataStore pattern as [com.eduardoarce.kitchenbot.printer.api.ApiSettingsStore].
 *
 * The logo bytes stay in [LogoStore]; here we store only the path so the two
 * concerns (image file vs. template fields) don't get entangled.
 */
class ReceiptTemplateStore(private val context: Context) {

    val template: Flow<ReceiptTemplate> = context.receiptTemplateDataStore.data.map { prefs ->
        ReceiptTemplate(
            headerTitle = prefs[HEADER_TITLE_KEY] ?: "",
            headerLine1 = prefs[KEY_HEADER_LINE_1] ?: "",
            headerLine2 = prefs[KEY_HEADER_LINE_2] ?: "",
            logoPath = prefs[KEY_LOGO_PATH]?.takeIf { it.isNotBlank() },
            footer = prefs[KEY_FOOTER] ?: "",
            style = PrintStyle(
                fontSize = prefs[KEY_FONT_SIZE]?.let { runCatching { FontSize.valueOf(it) }.getOrNull() }
                    ?: FontSize.NORMAL,
                uppercase = prefs[KEY_UPPERCASE] ?: false,
                paperSize = prefs[KEY_PAPER_SIZE]?.let { runCatching { PaperSize.valueOf(it) }.getOrNull() }
                    ?: PaperSize.MM80
            )
        )
    }

    suspend fun save(template: ReceiptTemplate) {
        context.receiptTemplateDataStore.edit { prefs ->
            prefs[HEADER_TITLE_KEY] = template.headerTitle.trim()
            prefs[KEY_HEADER_LINE_1] = template.headerLine1.trim()
            prefs[KEY_HEADER_LINE_2] = template.headerLine2.trim()
            prefs[KEY_LOGO_PATH] = template.logoPath ?: ""
            prefs[KEY_FOOTER] = template.footer.trim()
            prefs[KEY_FONT_SIZE] = template.style.fontSize.name
            prefs[KEY_UPPERCASE] = template.style.uppercase
            prefs[KEY_PAPER_SIZE] = template.style.paperSize.name
        }
    }

    suspend fun setHeaderTitle(value: String) = edit { it[HEADER_TITLE_KEY] = value.trim() }
    suspend fun setHeaderLine1(value: String) = edit { it[KEY_HEADER_LINE_1] = value.trim() }
    suspend fun setHeaderLine2(value: String) = edit { it[KEY_HEADER_LINE_2] = value.trim() }
    suspend fun setFooter(value: String) = edit { it[KEY_FOOTER] = value.trim() }
    suspend fun setLogoPath(path: String?) = edit { it[KEY_LOGO_PATH] = path ?: "" }
    suspend fun setFontSize(fontSize: FontSize) = edit { it[KEY_FONT_SIZE] = fontSize.name }
    suspend fun setUppercase(enabled: Boolean) = edit { it[KEY_UPPERCASE] = enabled }
    suspend fun setPaperSize(paperSize: PaperSize) = edit { it[KEY_PAPER_SIZE] = paperSize.name }

    suspend fun currentTemplate(): ReceiptTemplate = template.first()

    private suspend fun edit(block: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        context.receiptTemplateDataStore.edit(block)
    }

    private companion object {
        val KEY_HEADER_LINE_1 = stringPreferencesKey("header_line_1")
        val KEY_HEADER_LINE_2 = stringPreferencesKey("header_line_2")
        val KEY_LOGO_PATH = stringPreferencesKey("logo_path")
        val KEY_FOOTER = stringPreferencesKey("footer")
        val KEY_FONT_SIZE = stringPreferencesKey("font_size")
        val KEY_UPPERCASE = booleanPreferencesKey("uppercase")
        val KEY_PAPER_SIZE = stringPreferencesKey("paper_size")
    }
}
