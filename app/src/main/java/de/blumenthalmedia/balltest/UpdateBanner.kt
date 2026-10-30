package de.blumenthalmedia.balltest

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.io.File

/**
 * Update-Hinweis am unteren Rand. Er ist nur sichtbar, wenn es wirklich eine
 * neuere Version gibt (oder gerade geladen bzw. installiert wird).
 */
class UpdateBanner(private val activity: Activity, private val scope: CoroutineScope) {

    private fun dp(v: Int) = (v * activity.resources.displayMetrics.density).toInt()

    private val text = TextView(activity).apply {
        setTextColor(Color.WHITE)
        textSize = 15f
    }

    private val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
        max = 100
        visibility = View.GONE
    }

    private val button = Button(activity).apply {
        isAllCaps = false
        visibility = View.GONE
    }

    val view = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(14), dp(16), dp(14))
        background = GradientDrawable().apply {
            setColor(Color.parseColor("#F2101820"))
            setStroke(dp(1), Color.parseColor("#33FFFFFF"))
            cornerRadius = dp(16).toFloat()
        }
        elevation = dp(8).toFloat()
        visibility = View.GONE
        addView(text)
        addView(bar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
    }

    init {
        InstallStatus.listener = { message -> showMessage(message) }
    }

    /** Fragt GitHub nach der neuesten Version. Fehler bleiben unsichtbar. */
    fun checkNow() {
        scope.launch {
            try {
                val latest = Updater.fetchLatest()
                if (latest.versionCode > Updater.installedVersionCode(activity)) {
                    showAvailable(latest)
                }
            } catch (_: Exception) {
                // keine Verbindung o. Ä.: kein Hinweis
            }
        }
    }

    private fun show(message: String, progress: Int? = null, buttonText: String? = null, onClick: (() -> Unit)? = null) {
        view.visibility = View.VISIBLE
        text.text = message
        if (progress != null) {
            bar.visibility = View.VISIBLE
            bar.progress = progress
        } else {
            bar.visibility = View.GONE
        }
        if (buttonText != null && onClick != null) {
            button.visibility = View.VISIBLE
            button.text = buttonText
            button.setOnClickListener { onClick() }
        } else {
            button.visibility = View.GONE
        }
    }

    private fun showMessage(message: String) {
        // Rückmeldung des Installers: Text aktualisieren, Knopf zum erneuten Versuch behalten
        val file = downloaded
        show(message, null, if (file != null) "Erneut installieren" else null, if (file != null) ({ install(file) }) else null)
    }

    private fun showAvailable(info: UpdateInfo) {
        show("Update verfügbar: Build ${info.versionCode}", null, "Herunterladen und installieren") { download(info) }
    }

    private var downloaded: File? = null

    private fun download(info: UpdateInfo) {
        scope.launch {
            try {
                show("Lade Update … 0 %", 0)
                val file = Updater.download(activity, info.downloadUrl) { p ->
                    view.post { show("Lade Update … ${(p * 100).toInt()} %", (p * 100).toInt()) }
                }
                downloaded = file
                install(file)
            } catch (e: Exception) {
                show("Update fehlgeschlagen: ${e.message}", null, "Erneut versuchen") { download(info) }
            }
        }
    }

    private fun install(file: File) {
        if (!Updater.canInstall(activity)) {
            Updater.openInstallPermissionSettings(activity)
            show(
                "Bitte erlaube in den Einstellungen die Installation aus dieser Quelle, komm zurück und tippe auf „Installieren“.",
                null,
                "Installieren"
            ) { install(file) }
            return
        }
        try {
            Updater.install(activity, file)
            show("Installation läuft …", null, "Erneut installieren") { install(file) }
        } catch (e: Exception) {
            show("Installation fehlgeschlagen: ${e.message}", null, "Erneut installieren") { install(file) }
        }
    }
}
