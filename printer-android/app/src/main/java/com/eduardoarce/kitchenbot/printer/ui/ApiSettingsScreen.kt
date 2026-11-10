package com.eduardoarce.kitchenbot.printer.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.eduardoarce.kitchenbot.printer.api.ApiSettings
import com.eduardoarce.kitchenbot.printer.api.ApiSettingsStore
import com.eduardoarce.kitchenbot.printer.api.KitchenApiFactory
import com.eduardoarce.kitchenbot.printer.api.ProvisioningPayload
import com.eduardoarce.kitchenbot.printer.dashboard.DashboardUrl
import com.eduardoarce.kitchenbot.printer.printer.PrinterViewModel
import com.eduardoarce.kitchenbot.printer.queue.PrintQueueService
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Kitchen API connection settings. Values are persisted in DataStore and read
 * by [PrintQueueService]; once settings are complete, auto-print is always on.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApiSettingsScreen(
    viewModel: PrinterViewModel,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val store = remember { ApiSettingsStore(context.applicationContext) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    var loaded by remember { mutableStateOf(false) }
    var baseUrl by remember { mutableStateOf("") }
    var printerToken by remember { mutableStateOf("") }
    var kitchenId by remember { mutableStateOf("") }
    var printerIdentifier by remember { mutableStateOf("") }
    var printerMac by remember { mutableStateOf("") }
    var kitchenName by remember { mutableStateOf("") }
    var dashboardUrl by remember { mutableStateOf("") }
    var pollInterval by remember { mutableStateOf(ApiSettings.DEFAULT_POLL_INTERVAL_SECONDS.toString()) }

    // ponytail: in-memory dev gate — tap the title 7× to reveal the raw
    // connection fields. Resets on leaving the screen, no persistence.
    var developerMode by remember { mutableStateOf(false) }
    var titleTaps by remember { mutableStateOf(0) }

    LaunchedEffect(Unit) {
        val settings = store.settings.first()
        baseUrl = settings.baseUrl
        printerToken = settings.printerToken
        kitchenId = settings.kitchenId
        printerIdentifier = settings.printerIdentifier
        printerMac = settings.printerMac
        kitchenName = settings.kitchenName
        dashboardUrl = settings.dashboardUrl
        pollInterval = settings.pollIntervalSeconds.toString()
        loaded = true
        if (settings.isComplete) {
            store.save(settings.copy(pollingEnabled = true))
            PrintQueueService.start(context)
        }
    }

    fun currentSettings() = ApiSettings(
        baseUrl = baseUrl,
        printerToken = printerToken,
        kitchenId = kitchenId,
        printerIdentifier = printerIdentifier,
        printerMac = printerMac,
        kitchenName = kitchenName,
        dashboardUrl = dashboardUrl,
        pollingEnabled = true,
        pollIntervalSeconds = pollInterval.toIntOrNull()
            ?: ApiSettings.DEFAULT_POLL_INTERVAL_SECONDS
    )

    fun saveAndSyncService(showSaved: Boolean = false) {
        scope.launch {
            val settings = currentSettings()
            store.save(settings)
            if (settings.isComplete) {
                PrintQueueService.start(context)
            } else {
                PrintQueueService.stop(context)
            }
            if (showSaved) snackbarHostState.showSnackbar("Ajustes guardados")
        }
    }

    // Enqueues a "CONEXIÓN LISTA" test job on the backend. It prints through the
    // normal auto-print service once a Bluetooth printer is selected.
    fun enqueueTestPrint() {
        val settings = currentSettings()
        if (settings.baseUrl.isBlank() || settings.printerToken.isBlank() ||
            settings.kitchenId.isBlank() || settings.printerIdentifier.isBlank()
        ) {
            scope.launch { snackbarHostState.showSnackbar("Faltan datos de la API") }
            return
        }
        scope.launch {
            val message = try {
                val api = KitchenApiFactory.create(settings.baseUrl, settings.printerToken)
                val response = withContext(Dispatchers.IO) {
                    api.createTestPrint(settings.kitchenId, settings.printerIdentifier)
                }
                if (response.isSuccessful && response.body()?.ok == true) {
                    if (settings.isComplete) {
                        "Prueba enviada — imprimiendo…"
                    } else {
                        "Prueba en cola — selecciona impresora Bluetooth"
                    }
                } else {
                    "No se pudo enviar la prueba (${response.code()})"
                }
            } catch (e: Exception) {
                "Sin conexión con la API (${e.message ?: "error"})"
            }
            snackbarHostState.showSnackbar(message)
        }
    }

    // Opens the optional web dashboard in a browser. The URL is only the explicit
    // dashboard field; there is no derived default.
    fun openDashboard() {
        val url = DashboardUrl.resolve(dashboardUrl)
        if (url == null) {
            scope.launch { snackbarHostState.showSnackbar("Configura la URL del tablero") }
            return
        }
        saveAndSyncService()
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            scope.launch { snackbarHostState.showSnackbar("No hay navegador para abrir $url") }
        }
    }

    // QR provisioning: scan the code shown on the backend page and fill the
    // connection fields. The Bluetooth printer (printerMac) stays a manual pick.
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val raw = result.contents
        if (raw == null) return@rememberLauncherForActivityResult // user cancelled
        val payload = ProvisioningPayload.parse(raw)
        if (payload == null) {
            scope.launch { snackbarHostState.showSnackbar("Código QR no válido") }
        } else {
            baseUrl = payload.baseUrl
            printerToken = payload.printerToken
            kitchenId = payload.kitchenId
            printerIdentifier = payload.printerIdentifier
            // kitchenName is not a user field; scanning binds the printer to a
            // kitchen, so the ticket header follows that kitchen's backend name.
            if (payload.kitchenName.isNotBlank()) {
                kitchenName = payload.kitchenName
                viewModel.setHeaderTitleFromProvisioning(payload.kitchenName)
            }
            scope.launch {
                store.save(currentSettings())
                if (currentSettings().isComplete) PrintQueueService.start(context)
                snackbarHostState.showSnackbar("Configuración escaneada")
            }
            // Queue a connection-ready test print so the first thing that prints
            // once a printer is picked is "CONEXIÓN LISTA".
            enqueueTestPrint()
        }
    }

    fun launchScan() {
        scanLauncher.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Escanea el QR de provisión")
                .setBeepEnabled(false)
                .setOrientationLocked(false)
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Configuración",
                        modifier = Modifier.clickable {
                            titleTaps++
                            if (titleTaps >= 7) {
                                titleTaps = 0
                                developerMode = !developerMode
                                scope.launch {
                                    snackbarHostState.showSnackbar(
                                        if (developerMode) "Modo desarrollador activado"
                                        else "Modo desarrollador desactivado"
                                    )
                                }
                            }
                        }
                    )
                },
                navigationIcon = { TextButton(onClick = onBack) { Text("Atrás") } }
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
            Button(
                onClick = { launchScan() },
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Escanear QR") }
            Text(
                "Escanea el código del panel de la cocina para llenar los datos automáticamente. Luego elige la impresora Bluetooth abajo.",
                style = MaterialTheme.typography.bodySmall
            )

            if (developerMode) {
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("URL de la API (http://IP:3000)") },
                singleLine = true,
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = printerToken,
                onValueChange = { printerToken = it },
                label = { Text("Printer token") },
                singleLine = true,
                enabled = loaded,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = kitchenId,
                onValueChange = { kitchenId = it },
                label = { Text("Kitchen ID") },
                singleLine = true,
                enabled = loaded,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = printerIdentifier,
                onValueChange = { printerIdentifier = it },
                label = { Text("Printer identifier (registrado en el backend)") },
                singleLine = true,
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = pollInterval,
                onValueChange = { pollInterval = it },
                label = { Text("Intervalo de consulta (segundos)") },
                singleLine = true,
                enabled = loaded,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )
            }

            Text("Impresora para auto-impresión", style = MaterialTheme.typography.titleMedium)
            val paired = remember(loaded) { runCatching { viewModel.pairedDevices() }.getOrDefault(emptyList()) }
            if (paired.isEmpty()) {
                Text(
                    "No hay impresoras emparejadas. Empareja la impresora en Ajustes de Android.",
                    style = MaterialTheme.typography.bodyMedium
                )
            } else {
                paired.forEach { device ->
                    val selected = device.address.equals(printerMac, ignoreCase = true)
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(device.displayName(), style = MaterialTheme.typography.titleSmall)
                                Text(device.address, style = MaterialTheme.typography.bodySmall)
                            }
                            if (selected) {
                                Text("Seleccionada", style = MaterialTheme.typography.labelMedium)
                            } else {
                                TextButton(onClick = {
                                    printerMac = device.address
                                    saveAndSyncService(showSaved = true)
                                }) { Text("Usar") }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(4.dp))

            if (developerMode) {
                Button(
                    onClick = {
                        saveAndSyncService(showSaved = true)
                    },
                    enabled = loaded,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Guardar") }
            }

            OutlinedButton(
                onClick = {
                    saveAndSyncService()
                    enqueueTestPrint()
                },
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Probar conexión (imprime CONEXIÓN LISTA)") }

            Spacer(Modifier.height(4.dp))

            Text("Tablero de pedidos (pantalla de cocina)", style = MaterialTheme.typography.titleMedium)
            if (developerMode) {
                OutlinedTextField(
                    value = dashboardUrl,
                    onValueChange = { dashboardUrl = it },
                    label = { Text("URL del panel web (opcional), p. ej. http://IP:PUERTO/") },
                    singleLine = true,
                    enabled = loaded,
                    modifier = Modifier.fillMaxWidth()
                )
                Text(
                    "Déjalo vacío si no usas un panel web.",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Button(
                onClick = { openDashboard() },
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Abrir tablero de cocina") }
        }
    }
}
