package com.eduardoarce.kitchenbot.printer.printer

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.dantsu.escposprinter.connection.DeviceConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The one place the UI talks to. Exposes:
 *  - [state]: single StateFlow<ConnectionState>
 *  - [messages]: one-shot transient feedback for Snackbars
 *  - [template]: the editable, persisted [ReceiptTemplate] shared by both print
 *    paths (survives rotation, nav, reconnects — it's backed by DataStore)
 *
 * Connection is connect-per-job: each print/cut opens a fresh SPP socket and
 * closes it (the pattern proven on the hardware). A failed job is retried once
 * after a short delay (auto-reprint), then surfaces Error + Retry. [busy] is
 * true while a job runs so the UI can block overlapping taps and show progress.
 */
class PrinterViewModel(
    private val repository: BluetoothRepository,
    private val logoStore: LogoStore,
    private val templateStore: ReceiptTemplateStore,
    private val printerService: EscPosPrinterService = EscPosPrinterService()
) : ViewModel() {

    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    /**
     * The shared, persisted [ReceiptTemplate] — the ViewModel's editable state
     * for the ticket layout, mirrored from [ReceiptTemplateStore]. The editor UI
     * drives it via the setters below; the auto-print path reads the same store.
     */
    private val _template = MutableStateFlow(ReceiptTemplate())
    val template: StateFlow<ReceiptTemplate> = _template.asStateFlow()

    /** True while a print/cut job is running — UI disables actions and shows progress. */
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** Last device connected to (for auto-reconnect) and last action (for Retry). */
    private var lastDevice: BluetoothDevice? = null
    private var lastAction: (() -> Unit)? = null

    init {
        // Mirror the persisted template so the editor UI and the auto-print path
        // share one source of truth.
        viewModelScope.launch { templateStore.template.collect { _template.value = it } }
        // If a logo file exists from before the template stored its path, seed it.
        viewModelScope.launch {
            val existing = logoStore.existingPath()
            if (existing != null && templateStore.currentTemplate().logoPath == null) {
                templateStore.setLogoPath(existing)
            }
        }
    }

    val isBluetoothEnabled: Boolean get() = repository.isBluetoothEnabled

    fun pairedDevices(): List<BluetoothDevice> = repository.pairedDevices()

    // ---- Template editing (persisted; consumed by both print paths) ----
    fun setHeaderTitle(value: String) = persistTemplate { it.setHeaderTitle(value) }
    fun setHeaderLine1(value: String) = persistTemplate { it.setHeaderLine1(value) }
    fun setHeaderLine2(value: String) = persistTemplate { it.setHeaderLine2(value) }
    fun setFooter(value: String) = persistTemplate { it.setFooter(value) }
    fun setFontSize(fontSize: FontSize) = persistTemplate { it.setFontSize(fontSize) }
    fun setUppercase(enabled: Boolean) = persistTemplate { it.setUppercase(enabled) }

    /**
     * Linking a printer via QR binds it to a kitchen, so the ticket header
     * follows that kitchen's current name from the backend — overwriting any
     * previous header (e.g. a stale name left by an earlier QR).
     */
    fun setHeaderTitleFromProvisioning(kitchenName: String) {
        if (kitchenName.isBlank()) return
        persistTemplate { it.setHeaderTitle(kitchenName) }
    }

    private fun persistTemplate(block: suspend (ReceiptTemplateStore) -> Unit) {
        viewModelScope.launch { block(templateStore) }
    }

    // ---- Logo ----
    /** Picked from the photo picker: persist the bytes to filesDir, store the path. */
    fun onLogoPicked(uri: Uri) {
        viewModelScope.launch {
            val path = logoStore.save(uri)
            if (path != null) {
                templateStore.setLogoPath(path)
                _messages.tryEmit("Logo added")
            } else {
                _messages.tryEmit("Couldn't load that image")
            }
        }
    }

    fun removeLogo() {
        logoStore.delete()
        viewModelScope.launch { templateStore.setLogoPath(null) }
    }

    // ---- Connection ----
    fun connect(device: BluetoothDevice) {
        lastDevice = device
        lastAction = null
        _state.value = ConnectionState.Connecting
        viewModelScope.launch {
            _state.value = try {
                repository.connect(device)
                ConnectionState.Connected(device)
            } catch (e: Exception) {
                // IOException (surfaced by DantSu as EscPosConnectionException) etc.
                repository.disconnect()
                ConnectionState.Error(e.message ?: "Connection failed")
            }
        }
    }

    fun disconnect() {
        lastAction = null
        viewModelScope.launch {
            withContext(Dispatchers.IO) { repository.disconnect() }
            _state.value = ConnectionState.Disconnected
        }
    }

    /** Retry the last failed action (print/cut), or reconnect if there was none. */
    fun retry() {
        val action = lastAction
        if (action != null) action() else lastDevice?.let { connect(it) }
    }

    // ---- Print / cut ----
    /**
     * Prints an already-built [receipt] with [style] (connect-per-job). The
     * editor's "Test print" passes the sample order + current template style.
     */
    fun printReceipt(receipt: Receipt, style: PrintStyle) {
        lastAction = { printReceipt(receipt, style) }
        executeJob(success = "Printed & cut", failure = "Print failed") {
            EscPosPrinterService.forPaperSize(style.paperSize).print(it, receipt, style)
        }
    }

    fun cut() {
        lastAction = ::cut
        executeJob(success = "Paper cut", failure = "Cut failed") {
            printerService.cut(it)
        }
    }

    /**
     * Runs a printer job connect-per-job. Each attempt opens a fresh connection
     * (via repository.runJob), so a failure is auto-recovered by simply retrying
     * ONCE — attempt 2 reconnects and re-sends (auto-reprint). If it still fails,
     * surface Error + Retry. docs/02-Architecture.md §4.
     */
    private fun executeJob(
        success: String,
        failure: String,
        block: (DeviceConnection) -> Unit
    ) {
        if (_busy.value) return // a job is already running — ignore overlapping taps
        _busy.value = true
        viewModelScope.launch {
            try {
                var attempt = 0
                while (true) {
                    attempt++
                    try {
                        repository.runJob(block)
                        _messages.tryEmit(success)
                        lastDevice?.let {
                            if (_state.value !is ConnectionState.Connected) {
                                _state.value = ConnectionState.Connected(it)
                            }
                        }
                        return@launch
                    } catch (e: Exception) {
                        if (attempt >= MAX_PRINT_ATTEMPTS) {
                            _state.value = ConnectionState.Error(
                                "$failure. Turn the printer on, then tap Retry."
                            )
                            return@launch
                        }
                        // Wait for the printer to come back before re-sending.
                        _messages.tryEmit("$failure — retrying…")
                        delay(RETRY_DELAY_MS)
                    }
                }
            } finally {
                _busy.value = false
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        // Close the socket when the ViewModel dies (docs/02-Architecture.md §4).
        repository.disconnect()
    }

    companion object {
        /** Total print attempts before giving up: 1 initial + 1 auto-retry. */
        private const val MAX_PRINT_ATTEMPTS = 2

        /** Pause before the auto-retry, giving a briefly-interrupted printer time to return. */
        private const val RETRY_DELAY_MS = 2000L

        fun factory(context: Context): ViewModelProvider.Factory {
            val appContext = context.applicationContext
            return viewModelFactory {
                initializer {
                    val manager = appContext.getSystemService(BluetoothManager::class.java)
                    PrinterViewModel(
                        repository = BluetoothRepository(manager?.adapter),
                        logoStore = LogoStore(appContext),
                        templateStore = ReceiptTemplateStore(appContext)
                    )
                }
            }
        }
    }
}
