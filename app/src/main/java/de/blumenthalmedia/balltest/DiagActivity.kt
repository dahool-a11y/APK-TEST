package de.blumenthalmedia.balltest

import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import java.io.File

/**
 * Diagnose für die CAN-Anbindung: listet alle Pakete, Dienste und Empfänger des Radios,
 * die nach CAN-Box, MCU oder Fahrzeugdaten aussehen, plus Geräteinfos und serielle Ports.
 * Der Bericht lässt sich teilen, damit die richtige Schnittstelle gebaut werden kann.
 */
class DiagActivity : ComponentActivity() {

    private val keywords = listOf(
        "can", "syu", "mcu", "fyt", "hiworld", "raise", "essgoo", "vehicle", "car", "obd",
        "txz", "ts10", "ts18", "uis", "bt.", "serial", "uart", "carinfo", "autolink"
    )

    private lateinit var out: TextView
    private var report = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bg = Color.parseColor("#070b10")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            setPadding(24, 24, 24, 24)
        }
        val share = Button(this).apply {
            text = "Bericht teilen"
            isAllCaps = false
            textSize = 18f
            minHeight = 120
            setOnClickListener { shareReport() }
        }
        out = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = android.graphics.Typeface.MONOSPACE
            setTextIsSelectable(true)
            text = "Scanne …"
        }
        root.addView(share, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(
            ScrollView(this).apply { addView(out) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        )
        setContentView(root)
        Thread {
            val r = try { buildReport() } catch (e: Exception) { "Fehler: $e" }
            runOnUiThread { report = r; out.text = r }
        }.start()
    }

    private fun shareReport() {
        if (report.isNotEmpty()) {
            val stamp = System.currentTimeMillis() / 1000
            ShareHelper.share(this, "can-diagnose-$stamp.txt", "text/plain", report)
        }
    }

    private fun sh(cmd: String): String = try {
        val p = Runtime.getRuntime().exec(arrayOf("sh", "-c", cmd))
        val s = p.inputStream.bufferedReader().readText()
        p.waitFor()
        s.trim()
    } catch (e: Exception) { "(${e.message})" }

    private fun buildReport(): String {
        val sb = StringBuilder()
        sb.appendLine("== Gerät ==")
        sb.appendLine("${Build.MANUFACTURER} ${Build.MODEL} / ${Build.DEVICE} / Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        sb.appendLine(Build.FINGERPRINT)
        sb.appendLine()
        sb.appendLine("== Display ==")
        val m = resources.displayMetrics
        sb.appendLine("${m.widthPixels}x${m.heightPixels} px, density ${m.density} (${m.densityDpi} dpi)")
        sb.appendLine()
        sb.appendLine("== Serielle Ports (lesbar?) ==")
        File("/dev").listFiles { f -> f.name.startsWith("tty") && !f.name.startsWith("ttyp") }
            ?.sortedBy { it.name }?.forEach { sb.appendLine("${it.path} read=${it.canRead()} write=${it.canWrite()}") }
        sb.appendLine()
        sb.appendLine("== Systemeigenschaften (can/mcu/syu/fyt) ==")
        sb.appendLine(sh("getprop | grep -iE 'can|mcu|syu|fyt|vehicle|uart|ts10|hiworld|raise' | head -60"))
        sb.appendLine()
        sb.appendLine("== Pakete ==")
        val pm = packageManager
        val flags = PackageManager.GET_SERVICES or PackageManager.GET_RECEIVERS or PackageManager.GET_PROVIDERS
        val pkgs = pm.getInstalledPackages(flags)
        for (p in pkgs.sortedBy { it.packageName }) {
            val name = p.packageName.lowercase()
            val system = (p.applicationInfo?.flags ?: 0) and android.content.pm.ApplicationInfo.FLAG_SYSTEM != 0
            val hit = keywords.any { name.contains(it) }
            val comps = buildList {
                p.services?.forEach { add("S ${it.name} exp=${it.exported}${it.permission?.let { x -> " perm=$x" } ?: ""}") }
                p.receivers?.forEach { add("R ${it.name} exp=${it.exported}") }
                p.providers?.forEach { add("P ${it.authority} exp=${it.exported}") }
            }
            val compHit = comps.filter { c -> listOf("can", "mcu", "vehicle", "carinfo", "syu").any { c.lowercase().contains(it) } }
            if (hit || (system && compHit.isNotEmpty())) {
                sb.appendLine("${p.packageName}  v${p.versionName}  ${if (system) "SYSTEM" else "user"}")
                (if (hit) comps else compHit).take(40).forEach { sb.appendLine("    $it") }
            }
        }
        sb.appendLine()
        sb.appendLine("Pakete gesamt: ${pkgs.size}")
        return sb.toString()
    }
}
