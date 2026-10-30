package de.blumenthalmedia.balltest

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Handler
import android.os.Looper
import androidx.core.content.IntentCompat

/** Letzter Installationsstatus; das Update-Banner hört hier mit. */
object InstallStatus {
    private val main = Handler(Looper.getMainLooper())

    @Volatile
    var listener: ((String) -> Unit)? = null

    fun post(message: String) {
        main.post { listener?.invoke(message) }
    }
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
                    InstallStatus.post("Bitte im Android-Dialog bestätigen …")
                    context.startActivity(confirm)
                } else {
                    InstallStatus.post("Installation fehlgeschlagen: kein Bestätigungsdialog erhalten")
                }
            }
            PackageInstaller.STATUS_SUCCESS ->
                InstallStatus.post("Installation erfolgreich – die App startet neu …")
            else ->
                InstallStatus.post("Installation fehlgeschlagen (Code $status): $detail")
        }
    }
}
