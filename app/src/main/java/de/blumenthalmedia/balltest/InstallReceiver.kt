package de.blumenthalmedia.balltest

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.IntentCompat

/** Letzter Installationsstatus, wird im Update-Overlay angezeigt. */
object InstallStatus {
    var message by mutableStateOf<String?>(null)
}

/** Empfängt die Rückmeldungen der PackageInstaller-Session. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()

        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Android braucht eine Bestätigung vom Nutzer: Dialog öffnen
                val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    InstallStatus.message = "Bitte im Android-Dialog bestätigen …"
                    context.startActivity(confirm)
                } else {
                    InstallStatus.message = "Installation fehlgeschlagen: kein Bestätigungsdialog erhalten"
                }
            }
            PackageInstaller.STATUS_SUCCESS ->
                InstallStatus.message = "Installation erfolgreich – App startet neu …"
            else ->
                InstallStatus.message = "Installation fehlgeschlagen (Code $status): $detail"
        }
    }
}
