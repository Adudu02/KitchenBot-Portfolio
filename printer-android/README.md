# printer-android

Android app that turns a phone into a kitchen ticket-printer bridge. It polls
a kitchen API for pending orders, prints each one on a Bluetooth ESC/POS
thermal printer, and acknowledges the job back to the API. It can also print a
receipt by hand, edit the ticket layout, and trigger the paper cutter.

- **Stack:** Kotlin, Jetpack Compose, single-Activity MVVM, Coroutines +
  `StateFlow`, Retrofit/OkHttp for the API
- **Package:** `com.eduardoarce.kitchenbot.printer`
- **Min Android:** 8.0 (API 26); target and compile SDK 35
- **Printer link:** Bluetooth Classic (SPP) with ESC/POS via
  [DantSu/ESCPOS-ThermalPrinter-Android](https://github.com/DantSu/ESCPOS-ThermalPrinter-Android)
- **Language:** the app UI is in Spanish on purpose, because the product is
  built for Mexican kitchens. Code, comments and documentation are in English.

See `docs/` for the original requirements, architecture and getting-started
notes (written for the first Bluetooth-printing prototype; the polling and
provisioning layers came later and are described below).

## Requirements

- JDK 17 or 21 (Gradle 8.11.1 does not run on newer JDKs such as 25)
- Android SDK 35 (platform `android-35` and build-tools 35.0.0), pointed to by
  `ANDROID_HOME` or by a local `local.properties` containing `sdk.dir=...`.
  `local.properties` is gitignored; do not commit it.
- Network access on the first build, so Gradle can fetch its distribution and
  dependencies (including JitPack for the ESC/POS library)

## Build and test

From this directory:

```
./gradlew test            # unit tests (JVM, no device needed)
./gradlew assembleDebug   # debug APK
./gradlew lintDebug       # lint
```

On Windows use `gradlew.bat`. The debug APK is written to
`app/build/outputs/apk/debug/app-debug.apk`. Build outputs are not tracked in
this repository.

## What the app does

- **Provisioning:** scan a QR containing the API base URL, printer token,
  kitchen id, printer identifier and kitchen name; or fill those in by hand.
- **Print queue:** a foreground service polls
  `GET /kitchens/:kitchenId/print-queue`, prints unseen orders, and sends an
  acknowledgement (`PRINTED` or `FAILED`) per order. Polling backs off on
  errors; an order whose acknowledgement did not reach the API is printed
  again on the next poll.
- **Status sync:** heartbeat and printer/Bluetooth-device sync to the API, which
  can answer with remote ticket settings (header title, footer, paper size).
- **Printer status readback:** after a manual print, and when one fails, the app
  asks the printer for its physical state over ESC/POS `DLE EOT` (offline,
  paper out, cover open) so the UI can show the cause. Whether a given printer
  model answers is hardware-dependent and unverified.
- **Ticket editor:** header, logo, footer, uppercase style, live preview, test
  print and a standalone cut-paper action.
- **Optional dashboard shortcut:** a web view for a kitchen display. The mock
  API does not serve one, so leave that field empty when trying the app out.

The HTTP contract is small and fully implemented by
[`mock-kitchen-api`](../mock-kitchen-api/README.md); that README lists every
endpoint and payload.

## Try it without a real backend

You need an Android phone (8.0 or newer), a Bluetooth ESC/POS thermal printer
paired in Android settings (optional: without one you can still see the queue
and the app's error handling), and a computer on the same Wi-Fi network as the
phone.

1. Build the APK (see above) and install it on the phone:

   ```
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

   Without a cable, copy the APK to the phone and open it with a file manager,
   allowing "Install unknown apps" when asked.
2. Pair the printer in the phone's **Settings -> Bluetooth** (PIN is usually
   `0000` or `1234`).
3. Start the mock API from the repository root:

   ```
   npm install
   npm start -w mock-kitchen-api
   ```

   It prints a provisioning QR in the terminal. The QR advertises the first
   non-internal IPv4 address of the computer. If that is the wrong interface
   (a VPN or virtual adapter, for example), set `PUBLIC_BASE_URL` to an address
   the phone can reach:

   ```
   PUBLIC_BASE_URL=http://192.168.1.10:3000 npm start -w mock-kitchen-api
   ```

4. Open the app, grant the Bluetooth, camera and notification permissions,
   choose **Conectar con QR** and scan the QR from the terminal.
5. Pick the paired printer for auto-printing and save the settings.

Expected result (manual test checklist):

- The mock serves three fictitious pending orders. Scanning the QR also
  enqueues one test job automatically. Within one polling interval the app
  prints the orders and the test job (a ticket with a single "Test print" line)
  and acknowledges each one; the mock then returns an empty queue.
- **Probar conexión** in the settings screen enqueues another test job, which
  prints the same way.
- In the ticket editor, **Test print** prints a sample order using the current
  layout, and **Cut paper** cuts (or just feeds, if the printer has no cutter).

If the phone cannot reach the mock, check that both are on the same network,
that the computer's firewall allows port 3000, and that the base URL shown in
the terminal is reachable from the phone's browser.

## Distribution

Release builds would need a signed build and keystore, which are deliberately
not part of this repository. APKs are not committed.
