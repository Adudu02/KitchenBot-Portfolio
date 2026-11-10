package com.eduardoarce.kitchenbot.printer.ui

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.eduardoarce.kitchenbot.printer.api.ApiSettings
import com.eduardoarce.kitchenbot.printer.api.ApiSettingsStore
import com.eduardoarce.kitchenbot.printer.api.BluetoothDeviceDto
import com.eduardoarce.kitchenbot.printer.api.KitchenApiFactory
import com.eduardoarce.kitchenbot.printer.api.PrinterHeartbeatRequestDto
import com.eduardoarce.kitchenbot.printer.api.PrinterSyncRequestDto
import com.eduardoarce.kitchenbot.printer.api.ProvisioningPayload
import com.eduardoarce.kitchenbot.printer.printer.PrinterViewModel
import com.eduardoarce.kitchenbot.printer.printer.applyRemotePrinterSelection
import com.eduardoarce.kitchenbot.printer.printer.defaultPrinterMac
import com.eduardoarce.kitchenbot.printer.queue.PrintQueueService
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PrinterSyncScreen(viewModel: PrinterViewModel) {
    val context = LocalContext.current
    val store = remember { ApiSettingsStore(context.applicationContext) }
    val settings by store.settings.collectAsState(initial = ApiSettings())
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    var bluetoothDevices by remember { mutableStateOf<List<BluetoothDeviceDto>>(emptyList()) }
    var hasPermissions by remember { mutableStateOf(hasBluetoothPermissions(context)) }
    var bluetoothEnabled by remember { mutableStateOf(viewModel.isBluetoothEnabled) }
    var syncStatus by remember { mutableStateOf("Esperando conexión") }

    fun refreshBluetoothDevices() {
        hasPermissions = hasBluetoothPermissions(context)
        bluetoothEnabled = viewModel.isBluetoothEnabled
        bluetoothDevices = if (hasPermissions && bluetoothEnabled) {
            viewModel.pairedDevices().toBluetoothDtos()
        } else {
            emptyList()
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshBluetoothDevices()
    }

    val enableBtLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        refreshBluetoothDevices()
    }

    fun requestBluetoothAccess() {
        val needed = requiredBluetoothPermissions()
        if (!hasPermissions && needed.isNotEmpty()) {
            permissionLauncher.launch(needed.toTypedArray())
        } else if (!bluetoothEnabled) {
            enableBtLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
        } else {
            refreshBluetoothDevices()
        }
    }

    suspend fun syncOnce(inputSettings: ApiSettings, devices: List<BluetoothDeviceDto>) {
        if (!inputSettings.isProvisioned) return

        val selectedMac = inputSettings.printerMac.ifBlank { defaultPrinterMac(devices) }
        val api = KitchenApiFactory.create(inputSettings.baseUrl, inputSettings.printerToken)
        val response = withContext(Dispatchers.IO) {
            api.syncPrinter(
                kitchenId = inputSettings.kitchenId,
                printerIdentifier = inputSettings.printerIdentifier,
                body = PrinterSyncRequestDto(
                    status = if (selectedMac.isBlank()) "OFF" else "ON",
                    statusReason = if (selectedMac.isBlank()) "sin impresora Bluetooth seleccionada" else "ready",
                    appVersion = context.appVersionName(),
                    deviceModel = Build.MODEL,
                    printerMac = selectedMac.ifBlank { null },
                    bluetoothDevices = devices
                )
            )
        }

        val body = response.body()
        if (!response.isSuccessful || body?.ok != true) {
            if (response.code() == 404 || response.code() == 405) {
                val heartbeat = withContext(Dispatchers.IO) {
                    api.heartbeat(
                        kitchenId = inputSettings.kitchenId,
                        printerIdentifier = inputSettings.printerIdentifier,
                        body = PrinterHeartbeatRequestDto(
                            status = if (selectedMac.isBlank()) "OFF" else "ON",
                            statusReason = if (selectedMac.isBlank()) {
                                "legacy_sync:sin impresora Bluetooth seleccionada"
                            } else {
                                "legacy_sync:ready"
                            },
                            appVersion = context.appVersionName(),
                            deviceModel = Build.MODEL,
                            printerMac = selectedMac.ifBlank { null }
                        )
                    )
                }
                val heartbeatBody = heartbeat.body()
                if (!heartbeat.isSuccessful || heartbeatBody?.ok != true) {
                    throw IllegalStateException(heartbeatBody?.error ?: "heartbeat ${heartbeat.code()}")
                }
                syncStatus = "Conectado; backend pendiente de sync remoto"
                return
            }
            throw IllegalStateException(body?.error ?: "sync ${response.code()}")
        }

        val remoteMac = body.printer?.selectedPrinterMac
        val nextMac = applyRemotePrinterSelection(selectedMac, remoteMac).ifBlank { selectedMac }
        if (!nextMac.equals(inputSettings.printerMac, ignoreCase = true)) {
            store.save(inputSettings.copy(printerMac = nextMac, pollingEnabled = true))
        }
        syncStatus = if (nextMac.isBlank()) {
            "Conectado al servidor; esperando selección remota de impresora"
        } else {
            "Conectado y sincronizando"
        }
    }

    fun saveProvisioning(payload: ProvisioningPayload) {
        refreshBluetoothDevices()
        val selectedMac = defaultPrinterMac(bluetoothDevices)
        val nextSettings = ApiSettings(
            baseUrl = payload.baseUrl,
            printerToken = payload.printerToken,
            kitchenId = payload.kitchenId,
            printerIdentifier = payload.printerIdentifier,
            printerMac = selectedMac,
            kitchenName = payload.kitchenName,
            pollingEnabled = true
        )
        viewModel.setHeaderTitleFromProvisioning(payload.kitchenName)
        scope.launch {
            store.save(nextSettings)
            try {
                syncOnce(nextSettings, bluetoothDevices)
                PrintQueueService.start(context)
                snackbarHostState.showSnackbar("Conectado")
            } catch (e: Exception) {
                PrintQueueService.start(context)
                syncStatus = "Conectado; sincronización pendiente"
                snackbarHostState.showSnackbar("QR guardado; se reintentará la sincronización")
            }
        }
    }

    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val raw = result.contents ?: return@rememberLauncherForActivityResult
        val payload = ProvisioningPayload.parse(raw)
        if (payload == null) {
            scope.launch { snackbarHostState.showSnackbar("Código QR no válido") }
        } else {
            saveProvisioning(payload)
        }
    }

    fun openQrScanner() {
        requestBluetoothAccess()
        scanLauncher.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Escanea el QR de conexión")
                .setBeepEnabled(false)
                .setOrientationLocked(false)
        )
    }

    fun disconnect() {
        scope.launch {
            PrintQueueService.stop(context)
            viewModel.disconnect()
            store.clearConnection()
            syncStatus = "Esperando conexión"
            refreshBluetoothDevices()
            snackbarHostState.showSnackbar("Conexión eliminada")
        }
    }

    LaunchedEffect(Unit) {
        refreshBluetoothDevices()
        val current = store.settings.first()
        if (current.isProvisioned) {
            PrintQueueService.start(context)
            syncStatus = if (current.isComplete) "Conectado y sincronizando" else "Conectado; esperando impresora"
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("KitchenBot Printer") }) },
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
            if (!settings.isProvisioned) {
                DisconnectedPanel(
                    hasPermissions = hasPermissions,
                    bluetoothEnabled = bluetoothEnabled,
                    onConnect = { openQrScanner() },
                    onBluetoothAccess = { requestBluetoothAccess() }
                )
            } else {
                ConnectedPanel(
                    settings = settings,
                    syncStatus = syncStatus,
                    devices = bluetoothDevices,
                    onRefresh = {
                        refreshBluetoothDevices()
                        scope.launch {
                            try {
                                syncOnce(store.currentSettings(), bluetoothDevices)
                                snackbarHostState.showSnackbar("Sincronizado")
                            } catch (e: Exception) {
                                snackbarHostState.showSnackbar("No se pudo sincronizar")
                            }
                        }
                    },
                    onDisconnect = { disconnect() }
                )
            }
        }
    }
}

@Composable
private fun DisconnectedPanel(
    hasPermissions: Boolean,
    bluetoothEnabled: Boolean,
    onConnect: () -> Unit,
    onBluetoothAccess: () -> Unit
) {
    Text("Conectar impresora", style = MaterialTheme.typography.headlineSmall)
    Text(
        "Escanea el QR de la cocina para recibir la URL remota, la configuración y empezar la sincronización.",
        style = MaterialTheme.typography.bodyMedium
    )
    Button(onClick = onConnect, modifier = Modifier.fillMaxWidth()) {
        Text("Conectar con QR")
    }
    if (!hasPermissions || !bluetoothEnabled) {
        OutlinedButton(onClick = onBluetoothAccess, modifier = Modifier.fillMaxWidth()) {
            Text(if (!hasPermissions) "Permitir Bluetooth" else "Activar Bluetooth")
        }
    }
}

@Composable
private fun ConnectedPanel(
    settings: ApiSettings,
    syncStatus: String,
    devices: List<BluetoothDeviceDto>,
    onRefresh: () -> Unit,
    onDisconnect: () -> Unit
) {
    Text("Conexión activa", style = MaterialTheme.typography.headlineSmall)
    DetailCard {
        DetailRow("Estado", syncStatus)
        DetailRow("Cocina", settings.kitchenName.ifBlank { settings.kitchenId })
        DetailRow("API", settings.baseUrl)
        DetailRow("Printer ID", settings.printerIdentifier)
        DetailRow("Bluetooth", settings.printerMac.ifBlank { "Pendiente de selección remota" })
    }

    Text("Bluetooth sincronizado", style = MaterialTheme.typography.titleMedium)
    if (devices.isEmpty()) {
        Text("No hay dispositivos Bluetooth emparejados.", style = MaterialTheme.typography.bodyMedium)
    } else {
        devices.forEach { device ->
            DetailCard {
                DetailRow(device.name.ifBlank { "Sin nombre" }, device.address)
            }
        }
    }

    OutlinedButton(onClick = onRefresh, modifier = Modifier.fillMaxWidth()) {
        Text("Sincronizar ahora")
    }
    Button(onClick = onDisconnect, modifier = Modifier.fillMaxWidth()) {
        Text("Desconectar y reiniciar")
    }
}

@Composable
private fun DetailCard(content: @Composable () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            content()
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, modifier = Modifier.weight(0.35f), fontWeight = FontWeight.SemiBold)
        Text(value, modifier = Modifier.weight(0.65f))
    }
}

@SuppressLint("MissingPermission")
private fun List<BluetoothDevice>.toBluetoothDtos(): List<BluetoothDeviceDto> =
    map { BluetoothDeviceDto(name = it.name ?: it.address, address = it.address) }

private fun Context.appVersionName(): String? = runCatching {
    packageManager.getPackageInfo(packageName, 0).versionName
}.getOrNull()
