package com.eduardoarce.kitchenbot.printer.queue

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.eduardoarce.kitchenbot.printer.api.ApiSettings
import com.eduardoarce.kitchenbot.printer.api.ApiSettingsStore
import com.eduardoarce.kitchenbot.printer.api.AckPrintJobRequestDto
import com.eduardoarce.kitchenbot.printer.api.ApiErrorParser
import com.eduardoarce.kitchenbot.printer.api.KitchenApi
import com.eduardoarce.kitchenbot.printer.api.KitchenApiFactory
import com.eduardoarce.kitchenbot.printer.api.BluetoothDeviceDto
import com.eduardoarce.kitchenbot.printer.api.OrderReceiptMapper
import com.eduardoarce.kitchenbot.printer.api.PrinterHeartbeatRequestDto
import com.eduardoarce.kitchenbot.printer.api.PrinterSyncRequestDto
import com.eduardoarce.kitchenbot.printer.api.QueueOrderDto
import com.eduardoarce.kitchenbot.printer.api.RemotePrinterSettingsDto
import com.eduardoarce.kitchenbot.printer.printer.BluetoothRepository
import com.eduardoarce.kitchenbot.printer.printer.EscPosPrinterService
import com.eduardoarce.kitchenbot.printer.printer.FontSize
import com.eduardoarce.kitchenbot.printer.printer.LogoStore
import com.eduardoarce.kitchenbot.printer.printer.PaperSize
import com.eduardoarce.kitchenbot.printer.printer.PrintStyle
import com.eduardoarce.kitchenbot.printer.printer.Receipt
import com.eduardoarce.kitchenbot.printer.printer.ReceiptTemplateStore
import com.eduardoarce.kitchenbot.printer.printer.applyRemotePrinterSelection
import com.eduardoarce.kitchenbot.printer.printer.defaultPrinterMac
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Foreground service that polls the KitchenBot print-queue endpoint and
 * auto-prints newly CONFIRMED orders on the Bluetooth thermal printer, then
 * acks them back (PRINTED/FAILED) so the backend drops them from the queue.
 *
 * The backend only returns printStatus=PENDING orders. If an ack fails after a
 * physical print, the order is deliberately printed again on the next poll:
 * duplicate paper is safer than silently losing a kitchen ticket.
 * Bluetooth I/O reuses the connect-per-job model (fresh SPP socket per receipt).
 */
class PrintQueueService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val logoHttpClient = OkHttpClient()
    private lateinit var settingsStore: ApiSettingsStore
    private lateinit var templateStore: ReceiptTemplateStore
    private lateinit var logoStore: LogoStore
    private lateinit var bluetoothRepository: BluetoothRepository

    private var api: KitchenApi? = null
    private var apiKey: String = ""

    /** Consecutive Bluetooth print failures per printKey; FAILED-acked after the cap. */
    private val printFailures = mutableMapOf<String, Int>()

    private var loopStarted = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        settingsStore = ApiSettingsStore(applicationContext)
        templateStore = ReceiptTemplateStore(applicationContext)
        logoStore = LogoStore(applicationContext)
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
        bluetoothRepository = BluetoothRepository(adapter)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification("Iniciando…"))
        if (!loopStarted) {
            loopStarted = true
            scope.launch { pollLoop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun pollLoop() {
        var consecutiveErrors = 0
        while (true) {
            val settings = settingsStore.currentSettings()
            when {
                !settings.pollingEnabled -> {
                    stopSelf()
                    return
                }

                !settings.isProvisioned -> {
                    notify("Escanea el QR de conexión")
                    delay(IDLE_DELAY_MS)
                }

                else -> {
                    try {
                        val pending = pollOnce(settings)
                        consecutiveErrors = 0
                        notify("Última consulta ${timestamp()} — $pending pendiente(s)")
                    } catch (e: Exception) {
                        consecutiveErrors++
                        notify("Sin conexión con la API (${e.message ?: "error"})")
                    }
                    val backoff = minOf(consecutiveErrors, MAX_BACKOFF_MULTIPLIER)
                    delay(settings.pollIntervalSeconds * 1000L * (backoff + 1))
                }
            }
        }
    }

    /** One poll cycle: fetch queue, print unseen orders, ack. Returns pending count. */
    private suspend fun pollOnce(settings: ApiSettings): Int {
        val client = apiFor(settings)
        val devices = pairedBluetoothDevices()
        val selectedMac = settings.printerMac.ifBlank { defaultPrinterMac(devices) }
        val availability = if (selectedMac.isBlank()) {
            PrinterAvailability("OFF", "sin impresora Bluetooth seleccionada")
        } else {
            printerAvailability(selectedMac)
        }

        syncPrinter(client, settings, selectedMac, devices, availability.status, availability.reason)

        val syncedSettings = settingsStore.currentSettings()
        if (!syncedSettings.isComplete) {
            notify("Conectado — esperando selección remota de impresora")
            return 0
        }

        val syncedAvailability = printerAvailability(syncedSettings.printerMac)
        if (syncedAvailability.status != "ON") {
            syncPrinter(client, syncedSettings, syncedSettings.printerMac, devices, syncedAvailability.status, syncedAvailability.reason)
            throw IllegalStateException(syncedAvailability.reason)
        }

        val response = client.getPrintQueue(syncedSettings.kitchenId, syncedSettings.printerIdentifier)
        val body = response.body()

        if (!response.isSuccessful || body == null || !body.ok) {
            throw IllegalStateException(
                ApiErrorParser.messageFor(
                    responseCode = response.code(),
                    structuredError = body?.error,
                    rawErrorBody = response.errorBody()?.string()
                )
            )
        }

        // Read the template fresh each poll cycle so editor changes apply to the
        // next auto-print without restarting the service (cheap DataStore read).
        val template = templateStore.currentTemplate()

        for (order in body.orders) {
            notify("Imprimiendo pedido #${order.id}…")
            val receipt = OrderReceiptMapper.toReceipt(order, template)
            Log.i(
                TAG,
                "Auto-print start order=${order.id} printKey=${order.printKey} mac=${syncedSettings.printerMac} " +
                    "items=${receipt.items.size} style=${template.style}"
            )

            val printResult = printReceipt(syncedSettings.printerMac, receipt, template.style)
            if (printResult.success) {
                notify("Esperando confirmación de salida pedido #${order.id}…")
                delay(POST_PRINT_ACK_DELAY_MS)
                Log.i(TAG, "Auto-print completed before ACK order=${order.id} printKey=${order.printKey}")
                syncPrinter(client, syncedSettings, syncedSettings.printerMac, devices, "ON", "printed")
                printFailures.remove(order.printKey)
                settingsStore.addPrintedKey(order.printKey)   // guard against reprint if the ack fails
                ack(client, syncedSettings, order, "PRINTED")
                settingsStore.removePrintedKey(order.printKey) // ack landed → order leaves queue; drop the guard
                Log.i(TAG, "Auto-print ACK PRINTED order=${order.id} printKey=${order.printKey}")
            } else {
                syncPrinter(client, syncedSettings, syncedSettings.printerMac, devices, "OFF", printResult.message)
                val failures = (printFailures[order.printKey] ?: 0) + 1
                printFailures[order.printKey] = failures
                if (failures >= MAX_PRINT_FAILURES) {
                    // Printer unreachable repeatedly — tell the backend so the
                    // kitchen sees the order needs manual attention.
                    printFailures.remove(order.printKey)
                    ack(client, syncedSettings, order, "FAILED")
                }
                notify(
                    "Fallo de impresión pedido #${order.id} " +
                        "(intento $failures): ${printResult.message}"
                )
            }
        }

        return body.orders.size
    }

    private suspend fun syncPrinter(
        client: KitchenApi,
        settings: ApiSettings,
        selectedMac: String,
        devices: List<BluetoothDeviceDto>,
        status: String,
        reason: String
    ) {
        try {
            val response = client.syncPrinter(
                kitchenId = settings.kitchenId,
                printerIdentifier = settings.printerIdentifier,
                body = PrinterSyncRequestDto(
                    status = status,
                    statusReason = reason,
                    appVersion = appVersion(),
                    deviceModel = Build.MODEL,
                    printerMac = selectedMac.ifBlank { null },
                    bluetoothDevices = devices
                )
            )
            val body = response.body()
            if (!response.isSuccessful || body == null || !body.ok) {
                if (response.code() == 404 || response.code() == 405) {
                    sendHeartbeatFallback(client, settings, selectedMac, status, reason)
                    return
                }
                Log.w(TAG, "Printer sync rejected (${response.code()}); continuing")
                return
            }

            val remote = body.printer ?: return
            val nextMac = applyRemotePrinterSelection(settings.printerMac, remote.selectedPrinterMac)
                .ifBlank { settings.printerMac.ifBlank { defaultPrinterMac(devices) } }
            if (!nextMac.equals(settings.printerMac, ignoreCase = true)) {
                settingsStore.save(settings.copy(printerMac = nextMac, pollingEnabled = true))
            }
            applyRemoteSettings(remote.settings)
        } catch (e: Exception) {
            Log.w(TAG, "Printer sync failed (non-fatal): ${e.message}")
        }
    }

    private suspend fun sendHeartbeatFallback(
        client: KitchenApi,
        settings: ApiSettings,
        selectedMac: String,
        status: String,
        reason: String
    ) {
        val response = client.heartbeat(
            kitchenId = settings.kitchenId,
            printerIdentifier = settings.printerIdentifier,
            body = PrinterHeartbeatRequestDto(
                status = status,
                statusReason = "legacy_sync:$reason",
                appVersion = appVersion(),
                deviceModel = Build.MODEL,
                printerMac = selectedMac.ifBlank { null }
            )
        )
        val body = response.body()
        if (!response.isSuccessful || body == null || !body.ok) {
            Log.w(TAG, "Printer heartbeat fallback rejected (${response.code()}); continuing")
            return
        }
        Log.i(TAG, "Printer registered through heartbeat fallback")
    }

    private suspend fun applyRemoteSettings(settings: RemotePrinterSettingsDto) {
        if (!settings.hasAnyValue) return

        val current = templateStore.currentTemplate()
        val nextLogoPath = resolveRemoteLogoPath(settings, current.logoPath)
        templateStore.save(
            current.copy(
                headerTitle = settings.headerTitle ?: current.headerTitle,
                headerLine1 = settings.headerLine1 ?: current.headerLine1,
                headerLine2 = settings.headerLine2 ?: current.headerLine2,
                logoPath = nextLogoPath,
                footer = settings.footer ?: current.footer,
                style = current.style.copy(
                    fontSize = settings.fontSize?.let { runCatching { FontSize.valueOf(it) }.getOrNull() }
                        ?: current.style.fontSize,
                    uppercase = settings.uppercase ?: current.style.uppercase,
                    paperSize = settings.paperSize?.let { runCatching { PaperSize.valueOf(it) }.getOrNull() }
                        ?: current.style.paperSize
                )
            )
        )
    }

    private suspend fun resolveRemoteLogoPath(
        settings: RemotePrinterSettingsDto,
        currentLogoPath: String?
    ): String? {
        settings.logoPath?.let { path ->
            if (path.isBlank()) {
                logoStore.delete()
                return null
            }
            return path.trim()
        }

        settings.logoUrl?.let { url ->
            if (url.isBlank()) {
                logoStore.delete()
                return null
            }
            return downloadLogo(url.trim()) ?: currentLogoPath
        }

        return currentLogoPath
    }

    private suspend fun downloadLogo(url: String): String? {
        return try {
            val request = Request.Builder().url(url).get().build()
            logoHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val bytes = response.body?.bytes() ?: return null
                logoStore.saveBytes(bytes)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Remote printer logo download failed: ${e.message}")
            null
        }
    }

    @SuppressLint("MissingPermission")
    private fun printerAvailability(printerMac: String): PrinterAvailability {
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
            ?: return PrinterAvailability("OFF", "Bluetooth no disponible")

        val paired = try {
            adapter.bondedDevices?.any { it.address.equals(printerMac, ignoreCase = true) } == true
        } catch (_: SecurityException) {
            false
        }

        return if (paired) {
            PrinterAvailability("ON", "ready")
        } else {
            PrinterAvailability("OFF", "impresora Bluetooth no encontrada")
        }
    }

    @SuppressLint("MissingPermission")
    private fun pairedBluetoothDevices(): List<BluetoothDeviceDto> {
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        return try {
            adapter.bondedDevices?.map {
                BluetoothDeviceDto(name = it.name ?: it.address, address = it.address)
            } ?: emptyList()
        } catch (_: SecurityException) {
            emptyList()
        }
    }

    private suspend fun ack(
        client: KitchenApi,
        settings: ApiSettings,
        order: QueueOrderDto,
        printStatus: String
    ) {
        val response = client.ackPrintJob(
            kitchenId = settings.kitchenId,
            orderId = order.id,
            body = AckPrintJobRequestDto(
                printerIdentifier = settings.printerIdentifier,
                printKey = order.printKey,
                printStatus = printStatus,
                printedAt = isoTimestamp()
            )
        )
        val body = response.body()
        if (!response.isSuccessful || body == null || !body.ok) {
            throw IllegalStateException(
                ApiErrorParser.messageFor(
                    responseCode = response.code(),
                    structuredError = body?.error,
                    rawErrorBody = response.errorBody()?.string()
                )
            )
        }
    }

    /** Connect-per-job print on the configured paired printer. True on success. */
    @SuppressLint("MissingPermission")
    private suspend fun printReceipt(
        printerMac: String,
        receipt: Receipt,
        style: PrintStyle
    ): PrintResult {
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
            ?: return PrintResult(false, "Bluetooth no disponible")
        val device = try {
            adapter.bondedDevices?.firstOrNull { it.address.equals(printerMac, ignoreCase = true) }
        } catch (_: SecurityException) {
            null
        } ?: return PrintResult(false, "impresora Bluetooth no encontrada")

        repeat(MAX_PRINT_ATTEMPTS) { attempt ->
            try {
                Log.i(TAG, "Opening Bluetooth print attempt=${attempt + 1} mac=$printerMac")
                bluetoothRepository.runJob(device) { connection ->
                    EscPosPrinterService.forPaperSize(style.paperSize).print(connection, receipt, style)
                }
                Log.i(TAG, "Bluetooth print attempt=${attempt + 1} finished mac=$printerMac")
                return PrintResult(true)
            } catch (e: Exception) {
                Log.e(TAG, "Print attempt ${attempt + 1} failed for $printerMac", e)
                if (attempt + 1 < MAX_PRINT_ATTEMPTS) {
                    delay(RETRY_DELAY_MS)
                } else {
                    return PrintResult(
                        success = false,
                        message = e.message?.takeIf { it.isNotBlank() } ?: "error desconocido"
                    )
                }
            }
        }

        return PrintResult(false, "error desconocido")
    }

    private fun apiFor(settings: ApiSettings): KitchenApi {
        val key = "${settings.baseUrl}|${settings.printerToken}"
        val cached = api
        if (cached != null && key == apiKey) return cached
        val created = KitchenApiFactory.create(settings.baseUrl, settings.printerToken)
        api = created
        apiKey = key
        return created
    }

    // ---- Notification plumbing ----

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Auto-impresión de pedidos",
            NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification =
        Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Cola de impresión activa")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()

    private fun notify(text: String) {
        getSystemService(NotificationManager::class.java)
            ?.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun timestamp(): String =
        SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())

    private fun isoTimestamp(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }.format(Date())

    private fun appVersion(): String? = runCatching {
        packageManager.getPackageInfo(packageName, 0).versionName
    }.getOrNull()

    companion object {
        private const val TAG = "PrintQueueService"
        private const val CHANNEL_ID = "print_queue"
        private const val NOTIFICATION_ID = 1001
        private const val IDLE_DELAY_MS = 15_000L
        private const val MAX_BACKOFF_MULTIPLIER = 5
        private const val MAX_PRINT_FAILURES = 3
        private const val MAX_PRINT_ATTEMPTS = 2
        private const val RETRY_DELAY_MS = 2_000L
        private const val POST_PRINT_ACK_DELAY_MS = 1_000L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, PrintQueueService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, PrintQueueService::class.java))
        }
    }

    private data class PrintResult(
        val success: Boolean,
        val message: String = ""
    )

    private data class PrinterAvailability(
        val status: String,
        val reason: String
    )
}
