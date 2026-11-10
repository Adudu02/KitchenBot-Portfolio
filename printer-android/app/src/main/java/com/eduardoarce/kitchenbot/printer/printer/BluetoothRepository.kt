package com.eduardoarce.kitchenbot.printer.printer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import com.dantsu.escposprinter.connection.DeviceConnection
import com.dantsu.escposprinter.connection.bluetooth.BluetoothConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

/**
 * Bluetooth access using the CONNECT-PER-JOB model that the Prompt 2 spike
 * proved works on this printer: open a fresh SPP connection for each job, then
 * close it. (A single long-lived socket was tried but printing over a reused
 * DantSu connection was unreliable — these printers drop the idle link and
 * socket.isConnected() keeps returning true, so writes silently fail.)
 *
 * "Connected" therefore means "this printer is selected and was reachable",
 * not "a socket is held open". All blocking I/O runs on Dispatchers.IO.
 */
class BluetoothRepository(
    private val adapter: BluetoothAdapter?
) {
    /** The printer the user picked and we verified reachable. */
    var selectedDevice: BluetoothDevice? = null
        private set

    val isBluetoothEnabled: Boolean
        get() = adapter?.isEnabled == true

    @SuppressLint("MissingPermission")
    fun pairedDevices(): List<BluetoothDevice> =
        adapter?.bondedDevices?.toList() ?: emptyList()

    /**
     * Verifies [device] is reachable by opening then immediately closing a
     * connection, and remembers it as the selected printer. Throws on failure
     * (the ViewModel maps it to ConnectionState.Error).
     */
    @SuppressLint("MissingPermission")
    suspend fun connect(device: BluetoothDevice) = withContext(Dispatchers.IO) {
        openConnection(device).disconnect()
        selectedDevice = device
    }

    /**
     * Opens a fresh connection to the selected device, runs [block] on it, and
     * always closes it — exactly connect → print → disconnect per job.
     */
    @SuppressLint("MissingPermission")
    suspend fun <T> runJob(block: (DeviceConnection) -> T): T = withContext(Dispatchers.IO) {
        val device = selectedDevice
            ?: throw IllegalStateException("No printer selected")
        runJob(device, block)
    }

    /**
     * Same connect-per-job model, but for callers that already know the device
     * and do not need to mutate [selectedDevice].
     */
    @SuppressLint("MissingPermission")
    suspend fun <T> runJob(device: BluetoothDevice, block: (DeviceConnection) -> T): T =
        withContext(Dispatchers.IO) {
            val connection = openConnection(device)
            try {
                val result = block(connection)
                // Let the printer drain its buffer before we close the SPP socket.
                // These printers can drop the link mid-flush, and the write then
                // "succeeds" with no exception and no paper (see class doc) — a
                // longer settle greatly reduces those silently-lost tickets (fix #2).
                // SPP gives no delivery ack, so this mitigates but cannot
                // guarantee a physical print; true confirmation needs printer readback.
                delay(FLUSH_SETTLE_MS)
                result
            } finally {
                connection.disconnect()
            }
        }

    /**
     * Reads the printer's PHYSICAL state via the ESC/POS real-time status
     * commands (`DLE EOT n`) — the readback the class doc calls out as the only
     * real confirmation a job printed. DantSu's [DeviceConnection] is write-only
     * (no InputStream), so this opens a raw [android.bluetooth.BluetoothSocket]
     * (the raw-socket fallback named in docs/02-Architecture.md §1) to both send
     * the queries and read the replies on the same connection.
     *
     * Returns [PrinterStatus.UNKNOWN] if the printer answers nothing usable —
     * never throws for a silent printer; only a failed *connect* throws (which
     * the caller reads as "unreachable"). Runs on Dispatchers.IO.
     */
    @SuppressLint("MissingPermission")
    suspend fun queryStatus(device: BluetoothDevice): PrinterStatus = withContext(Dispatchers.IO) {
        adapter?.cancelDiscovery()
        val socket = device.createRfcommSocketToServiceRecord(UUID.fromString(SPP_UUID))
        try {
            socket.connect()
            val output = socket.outputStream
            val input = socket.inputStream
            // Drop any leftover ack bytes from a just-finished print job.
            input.skip(input.available().toLong())
            PrinterStatus.parse(
                printer = queryByte(output, input, DLE_EOT_PRINTER),
                offline = queryByte(output, input, DLE_EOT_OFFLINE),
                paper = queryByte(output, input, DLE_EOT_PAPER),
            )
        } finally {
            runCatching { socket.close() }
        }
    }

    /**
     * Sends one `DLE EOT n` query and returns the single status byte, or `null`
     * if the printer stayed silent within the poll window.
     *
     * ponytail: fixed short polling on `available()`, not an event-driven read —
     * Bluetooth SPP has no message framing, and `available()` is the only
     * non-blocking signal. If a future printer is slow to answer, raise
     * [STATUS_POLL_TRIES]; that's the tuning knob, not a redesign.
     */
    private suspend fun queryByte(out: OutputStream, input: InputStream, cmd: ByteArray): Int? {
        out.write(cmd)
        out.flush()
        repeat(STATUS_POLL_TRIES) {
            if (input.available() > 0) return input.read()
            delay(STATUS_POLL_INTERVAL_MS)
        }
        return null
    }

    /** Cancels discovery (it kills connect attempts) then opens an SPP socket. */
    @SuppressLint("MissingPermission")
    private fun openConnection(device: BluetoothDevice): BluetoothConnection {
        adapter?.cancelDiscovery()
        return BluetoothConnection(device).apply { connect() }
    }

    /** Forget the selected printer. No persistent socket is held. */
    fun disconnect() {
        selectedDevice = null
    }

    companion object {
        /** Bluetooth Classic Serial Port Profile UUID (used by DantSu internally). */
        const val SPP_UUID = "00001101-0000-1000-8000-00805F9B34FB"

        /** Pause after a print write before closing the socket, so the printer flushes. */
        const val FLUSH_SETTLE_MS = 2_500L

        // ESC/POS real-time status queries: DLE EOT n → 0x10 0x04 n.
        /** DLE EOT 1 — printer status (online/offline). */
        private val DLE_EOT_PRINTER = byteArrayOf(0x10, 0x04, 0x01)

        /** DLE EOT 2 — offline cause (cover open, error). */
        private val DLE_EOT_OFFLINE = byteArrayOf(0x10, 0x04, 0x02)

        /** DLE EOT 4 — paper-roll sensor (paper end / near-end). */
        private val DLE_EOT_PAPER = byteArrayOf(0x10, 0x04, 0x04)

        /** How many times to poll for a status reply before giving up on it. */
        private const val STATUS_POLL_TRIES = 10

        /** Delay between status-reply polls (≈300ms total worst case per query). */
        private const val STATUS_POLL_INTERVAL_MS = 30L
    }
}
