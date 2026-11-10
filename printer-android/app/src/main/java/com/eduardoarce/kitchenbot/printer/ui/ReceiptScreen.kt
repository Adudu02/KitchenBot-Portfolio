package com.eduardoarce.kitchenbot.printer.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.eduardoarce.kitchenbot.printer.api.OrderReceiptMapper
import com.eduardoarce.kitchenbot.printer.api.SampleOrder
import com.eduardoarce.kitchenbot.printer.printer.ConnectionState
import com.eduardoarce.kitchenbot.printer.printer.FontSize
import com.eduardoarce.kitchenbot.printer.printer.LogoImages
import com.eduardoarce.kitchenbot.printer.printer.PrinterViewModel
import com.eduardoarce.kitchenbot.printer.printer.ReceiptFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * The receipt-layout editor (FR-5..FR-7 reworked): edits the persisted
 * [com.eduardoarce.kitchenbot.printer.printer.ReceiptTemplate] — header title/lines, logo,
 * footer, font size and uppercase — and shows a WYSIWYG live preview driven by a
 * fixed [SampleOrder] through the REAL pipeline (OrderReceiptMapper →
 * ReceiptFormatter.previewText). Blank header fields visibly collapse the preview
 * upward — exactly what the paper will show. "Test print" prints that same sample
 * order; "Cut paper" is unchanged.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceiptScreen(
    state: ConnectionState,
    viewModel: PrinterViewModel,
    onDisconnect: () -> Unit
) {
    val template by viewModel.template.collectAsState()
    // Local state is the source of truth WHILE typing — never feed the field's
    // value back from the async DataStore per keystroke (that dropped chars and
    // jumped the cursor). Persist debounced; adopt external changes (e.g. QR
    // provisioning seeding the header) without clobbering in-flight typing.
    val headerTitle = rememberPersistedField(template.headerTitle, viewModel::setHeaderTitle)
    val footer = rememberPersistedField(template.footer, viewModel::setFooter)
    // Preview AND test print read the on-screen values, so they're correct even
    // before the debounced write lands.
    val editedTemplate = template.copy(headerTitle = headerTitle.value, footer = footer.value)

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(Unit) {
        viewModel.messages.collect { snackbarHostState.showSnackbar(it) }
    }

    val busy by viewModel.busy.collectAsState()

    // Android photo picker — no storage permission required.
    val pickLogo = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri -> uri?.let { viewModel.onLogoPicked(it) } }

    // Decode the persisted logo off the main thread for display (thumbnail + preview).
    val logoBitmap: ImageBitmap? by produceState<ImageBitmap?>(null, template.logoPath) {
        val path = template.logoPath
        value = if (path == null) {
            null
        } else {
            withContext(Dispatchers.IO) { LogoImages.decodeSampled(path, 240)?.asImageBitmap() }
        }
    }

    // The live preview and "Test print" run the SAME sample order through the
    // real mapping/formatting pipeline, so the preview matches the paper.
    val previewReceipt = OrderReceiptMapper.toReceipt(SampleOrder.order, editedTemplate)
    val previewText = ReceiptFormatter.previewText(
        receipt = previewReceipt,
        charsPerLine = editedTemplate.style.paperSize.charsPerLine,
        style = editedTemplate.style,
        hasVisibleLogo = logoBitmap != null
    )

    val connected = state is ConnectionState.Connected
    val connecting = state is ConnectionState.Connecting
    val error = state as? ConnectionState.Error

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Ticket") },
                // "Disconnect" only when there's a live connection; offline it's
                // just a way back to the printer list.
                actions = {
                    TextButton(onClick = onDisconnect) {
                        Text(if (connected) "Disconnect" else "Atrás")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (busy || connecting) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(
                        if (busy) "Working…" else "Reconnecting…",
                        style = MaterialTheme.typography.bodyLarge
                    )
                }
            }
            error?.let {
                Text(
                    it.message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyLarge
                )
                Button(onClick = { viewModel.retry() }, enabled = !busy) { Text("Retry") }
            }

            // --- Header ---
            Text("Encabezado", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = headerTitle.value,
                onValueChange = { headerTitle.value = it },
                label = { Text("Título del ticket") },
                placeholder = { Text("Empty = header omitted on paper") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            if (logoBitmap != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Image(
                        bitmap = logoBitmap!!,
                        contentDescription = "Ticket logo",
                        modifier = Modifier.size(72.dp)
                    )
                    TextButton(onClick = viewModel::removeLogo) { Text("✕ Remove logo") }
                }
            } else {
                OutlinedButton(
                    onClick = {
                        pickLogo.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                        )
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Add logo") }
            }
            OutlinedTextField(
                value = footer.value,
                onValueChange = { footer.value = it },
                label = { Text("Pie del ticket (opcional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            // --- Style ---
            Text("Estilo de impresión", style = MaterialTheme.typography.titleMedium)
            val sizes = listOf(
                FontSize.NORMAL to "Normal",
                FontSize.TALL to "Alto",
                FontSize.WIDE to "Ancho",
                FontSize.BIG to "Grande"
            )
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                sizes.forEachIndexed { index, (size, label) ->
                    SegmentedButton(
                        selected = template.style.fontSize == size,
                        onClick = { viewModel.setFontSize(size) },
                        shape = SegmentedButtonDefaults.itemShape(index = index, count = sizes.size)
                    ) { Text(label) }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("MAYÚSCULAS", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Switch(
                    checked = template.style.uppercase,
                    onCheckedChange = viewModel::setUppercase
                )
            }

            // --- Live preview (logo thumbnail + monospace body from the sample order) ---
            Text("Vista previa", style = MaterialTheme.typography.titleMedium)
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    logoBitmap?.let {
                        Image(
                            bitmap = it,
                            contentDescription = null,
                            modifier = Modifier.size(96.dp)
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    Text(
                        text = previewText,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                    )
                }
            }

            // --- Actions ---
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    onClick = { viewModel.printReceipt(previewReceipt, editedTemplate.style) },
                    enabled = connected && !busy,
                    modifier = Modifier.weight(1f)
                ) { Text("Test print") }
                OutlinedButton(
                    onClick = viewModel::cut,
                    enabled = connected && !busy,
                    modifier = Modifier.weight(1f)
                ) { Text("Cut paper") }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/**
 * Text-field state that types locally and persists lazily, avoiding the
 * keystroke→DataStore→StateFlow→recompose round-trip that drops characters and
 * jumps the cursor.
 *
 * - [external] seeds the field once and is re-adopted only on a genuine external
 *   change (e.g. QR provisioning), detected by "differs from what we last
 *   pushed" — so our own debounced echo never clobbers newer typing.
 * - Persists via [persist] 300ms after the last keystroke.
 */
@Composable
private fun rememberPersistedField(external: String, persist: (String) -> Unit): MutableState<String> {
    val local = remember { mutableStateOf(external) }
    var lastPushed by remember { mutableStateOf(external) }

    LaunchedEffect(external) {
        if (external != lastPushed) {
            local.value = external
            lastPushed = external
        }
    }
    LaunchedEffect(local.value) {
        if (local.value != lastPushed) {
            delay(300)
            lastPushed = local.value
            persist(local.value)
        }
    }
    return local
}
