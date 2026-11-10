package com.eduardoarce.kitchenbot.printer.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.eduardoarce.kitchenbot.printer.printer.PrinterViewModel

/**
 * Active APK UI.
 *
 * The previous multi-screen printer picker/settings/dashboard/receipt editor is
 * intentionally left in the source tree as the archived UI. Operators now get a
 * single connection screen: scan the backend QR, sync printer inventory and
 * settings remotely, then disconnect/reset when needed.
 */
@Composable
fun PrinterApp() {
    val context = LocalContext.current
    val viewModel: PrinterViewModel = viewModel(factory = PrinterViewModel.factory(context))
    PrinterSyncScreen(viewModel = viewModel)
}
