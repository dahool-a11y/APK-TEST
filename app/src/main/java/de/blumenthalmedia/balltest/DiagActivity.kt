package de.blumenthalmedia.balltest

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipFile

/**
 * Diagnose für die CAN-Anbindung des Radios. Alles passiv und nur lesend:
 *  1. Geräteinfos, serielle Ports, Pakete
 *  2. Textfunde aus der CAN-App des Radios (Manifest und Programmcode): Schnittstellen, Aktionen, Werte
 *  3. Live-Mitschnitt: lauscht auf die dort gefundenen Meldungen und zeigt jede Meldung samt Werten
 * Es werden keine Befehle an das Fahrzeug oder die CAN-App gesendet.
 */
class DiagActivity : ComponentActivity() {

    private val canPackage = "com.hcn.autocan"
    private val canService = "com.hcn.autocan.service.CanService"

    private val keywords = listOf(
        "can", "syu", "mcu", "fyt", "hiworld", "raise", "essgoo", "vehicle", "car", "obd",
        "txz", "hcn", "uart", "autolink"
    )
    private val valueWords = Regex(
        "speed|rpm|fuel|oil|mileage|odometer|odo|tank|trip|temp|coolant|gear|door|light|battery|volt|consum|distance|ignit|acc",
        RegexOption.IGNORE_CASE
    )

    private lateinit var out: TextView
    private lateinit var liveButton: Button
    private var report = ""
    private val live = StringBuilder()
    private var liveLines = 0
    private var receiver: BroadcastReceiver? = null
    private var actions: List<String> = emptyList()
    private val clock = SimpleDateFormat("HH:mm:ss.SSS", Locale.GERMANY)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bg = Color.parseColor("#070b10")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            setPadding(24, 24, 24, 24)
        }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        liveButton = Button(this).apply {
            text = "Live-Mitschnitt starten"
            isAllCaps = false
            textSize = 17f
            minHeight = 120
            setOnClickListener { toggleLive() }
        }
        val share = Button(this).apply {
            text = "Bericht teilen"
            isAllCaps = false
            textSize = 17f
            minHeight = 120
            setOnClickListener { shareReport() }
        }
        row.addView(liveButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(share, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        out = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 12f
            typeface = android.graphics.Typeface.MONOSPACE
            setTextIsSelectable(true)
            text = "Scanne …"
        }
        root.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(
            ScrollView(this).apply { addView(out) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        )
        setContentView(root)
        Thread {
            val r = try { buildReport() } catch (e: Throwable) { "Fehler: $e" }
            runOnUiThread { report = r; refresh() }
        }.start()
    }

    override fun onDestroy() {
        stopLive()
        super.onDestroy()
    }

    private fun refresh() {
        out.text = report + (if (live.isNotEmpty()) "\n== Live-Mitschnitt ==\n$live" else "")
    }

    private fun shareReport() {
        if (report.isEmpty()) return
        val stamp = System.currentTimeMillis() / 1000
        ShareHelper.share(this, "can-diagnose-$stamp.txt", "text/plain", out.text.toString())
    }

    /* ---------- Live-Mitschnitt ---------- */

    private fun toggleLive() {
        if (receiver == null) startLive() else stopLive()
    }

    private fun startLive() {
        if (actions.isEmpty()) {
            live.append("Keine Meldungen zum Lauschen gefunden.\n")
            refresh()
            return
        }
        val filter = IntentFilter().apply { actions.forEach { addAction(it) } }
        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val extras = intent.extras
                val values = extras?.keySet()?.sorted()?.joinToString(", ") { k ->
                    @Suppress("DEPRECATION")
                    val v = extras.get(k)
                    val shown = when (v) {
                        is ByteArray -> v.joinToString(" ") { b -> "%02X".format(b) }
                        is IntArray -> v.joinToString(",")
                        else -> v.toString()
                    }
                    "$k=${shown.take(120)}"
                } ?: "(ohne Werte)"
                append("${clock.format(Date())} ${intent.action}  $values")
            }
        }
        ContextCompat.registerReceiver(this, r, filter, ContextCompat.RECEIVER_EXPORTED)
        receiver = r
        liveButton.text = "Mitschnitt beenden"
        live.append("Lausche auf ${actions.size} Meldungen. Jetzt Zündung an, Gas geben, Licht, Blinker, Tür öffnen …\n")
        refresh()
    }

    private fun stopLive() {
        receiver?.let { try { unregisterReceiver(it) } catch (_: Exception) { } }
        receiver = null
        if (::liveButton.isInitialized) liveButton.text = "Live-Mitschnitt starten"
    }

    private fun append(line: String) {
        runOnUiThread {
            if (liveLines++ > 600) return@runOnUiThread
            live.append(line).append('\n')
            refresh()
        }
    }

    /* ---------- Bericht ---------- */

    private fun sh(cmd: String): String = try {
        val p = Runtime.getRuntime().exec(arrayOf("sh", "-c", cmd))
        val s = p.inputStream.bufferedReader().readText()
        p.waitFor()
        s.trim()
    } catch (e: Exception) { "(${e.message})" }

    /** Druckbare Zeichenfolgen (ASCII und UTF-16) aus einer Datei. */
    private fun printable(bytes: ByteArray, min: Int = 6): Set<String> {
        val result = LinkedHashSet<String>()
        val sb = StringBuilder()
        fun flush() { if (sb.length >= min) result.add(sb.toString()); sb.setLength(0) }
        for (b in bytes) {
            val c = b.toInt() and 0xff
            if (c in 0x20..0x7e) sb.append(c.toChar()) else flush()
        }
        flush()
        // UTF-16LE (Manifest-Strings): jedes zweite Byte ist 0
        var i = 0
        while (i + 1 < bytes.size) {
            val lo = bytes[i].toInt() and 0xff
            val hi = bytes[i + 1].toInt() and 0xff
            if (hi == 0 && lo in 0x20..0x7e) { sb.append(lo.toChar()); i += 2 } else { flush(); i += if (hi == 0) 2 else 1 }
        }
        flush()
        return result
    }

    private fun apkStrings(pkg: String): Pair<Set<String>, Set<String>> {
        val manifest = LinkedHashSet<String>()
        val code = LinkedHashSet<String>()
        val path = packageManager.getApplicationInfo(pkg, 0).sourceDir
        ZipFile(File(path)).use { zip ->
            zip.entries().asSequence().forEach { e ->
                val n = e.name
                if (n == "AndroidManifest.xml") manifest.addAll(printable(zip.getInputStream(e).readBytes(), 4))
                else if (n.endsWith(".dex")) code.addAll(printable(zip.getInputStream(e).readBytes(), 5))
            }
        }
        return manifest to code
    }

    private fun buildReport(): String {
        val sb = StringBuilder()
        sb.appendLine("== Gerät ==")
        sb.appendLine("${Build.MANUFACTURER} ${Build.MODEL} / Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        val m = resources.displayMetrics
        sb.appendLine("Display ${m.widthPixels}x${m.heightPixels}, ${m.densityDpi} dpi")
        sb.appendLine()

        sb.appendLine("== CAN-App $canPackage ==")
        try {
            val info = packageManager.getPackageInfo(canPackage, PackageManager.GET_SERVICES or PackageManager.GET_RECEIVERS or PackageManager.GET_PROVIDERS)
            sb.appendLine("Version ${info.versionName}, ${info.applicationInfo?.sourceDir}")
            info.services?.forEach { sb.appendLine("  Dienst ${it.name} exported=${it.exported}${it.permission?.let { p -> " permission=$p" } ?: ""}") }
            info.receivers?.forEach { sb.appendLine("  Empfänger ${it.name} exported=${it.exported}") }
            info.providers?.forEach { sb.appendLine("  Provider ${it.authority} exported=${it.exported}") }

            val (manifest, code) = apkStrings(canPackage)

            // Aktionen: Texte mit Punkt, die wie Meldungsnamen aussehen
            val actionRegex = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")
            val candidates = (manifest + code).filter { s ->
                actionRegex.matches(s) && !s.contains('$') && s.length < 90 &&
                    (s.contains("action", true) || s.contains("hcn", true) || s.contains("broadcast", true) ||
                        s.startsWith("android.intent.action.") && false)
            }.filterNot { s -> s.endsWith("Receiver") || s.endsWith("Service") || s.endsWith("Activity") || s.contains(".R.") }
            actions = candidates.take(80)

            sb.appendLine()
            sb.appendLine("-- Mögliche Meldungen (Aktionen), auf die der Mitschnitt lauscht (${actions.size}) --")
            actions.forEach { sb.appendLine("  $it") }

            sb.appendLine()
            sb.appendLine("-- Interne Klassen und Schnittstellen (com.hcn.*) --")
            code.filter { it.startsWith("Lcom/hcn/") || it.startsWith("com.hcn.") }
                .map { it.removePrefix("L").removeSuffix(";").replace('/', '.') }
                .filter { it.length < 100 }.distinct().take(120).forEach { sb.appendLine("  $it") }

            sb.appendLine()
            sb.appendLine("-- Textfunde zu Fahrzeugwerten (Geschwindigkeit, Kilometer, Tank, Öl …) --")
            code.filter { valueWords.containsMatchIn(it) && it.length in 4..70 && !it.contains(' ') && !it.startsWith("Landroid") && !it.startsWith("Ljava") }
                .distinct().take(200).forEach { sb.appendLine("  $it") }
        } catch (e: Throwable) {
            sb.appendLine("Fehler beim Lesen: $e")
        }
        sb.appendLine()

        sb.appendLine("== Dienst-Schnittstelle (nur Name, ohne Aufruf) ==")
        sb.appendLine(probeBinder())
        sb.appendLine()

        sb.appendLine("== Serielle Ports ==")
        File("/dev").listFiles { f -> f.name.startsWith("tty") && !f.name.startsWith("ttyp") }
            ?.sortedBy { it.name }?.forEach { sb.appendLine("${it.path} read=${it.canRead()} write=${it.canWrite()}") }
        sb.appendLine()
        sb.appendLine("== Systemeigenschaften ==")
        sb.appendLine(sh("getprop | grep -iE 'can|mcu|hcn|uart|vehicle' | head -40"))
        sb.appendLine()

        sb.appendLine("== Alle Systempakete mit hcn/txz/can/car ==")
        val pm = packageManager
        pm.getInstalledPackages(0).map { it.packageName }.sorted().forEach { n ->
            if (keywords.any { n.contains(it) }) {
                val sys = (pm.getApplicationInfo(n, 0).flags and ApplicationInfo.FLAG_SYSTEM) != 0
                sb.appendLine("  $n ${if (sys) "SYSTEM" else ""}")
            }
        }
        return sb.toString()
    }

    /** Verbindet kurz mit dem Dienst und liest nur den Schnittstellennamen. */
    private fun probeBinder(): String {
        val latch = java.util.concurrent.CountDownLatch(1)
        var result = "keine Verbindung (Dienst nicht erreichbar oder Berechtigung fehlt)"
        val conn = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, service: IBinder) {
                result = "verbunden, Schnittstelle: ${try { service.interfaceDescriptor } catch (e: Exception) { e.toString() }}"
                latch.countDown()
            }
            override fun onServiceDisconnected(name: ComponentName) {}
        }
        return try {
            val ok = bindService(Intent().setComponent(ComponentName(canPackage, canService)), conn, Context.BIND_AUTO_CREATE)
            if (!ok) result = "bindService abgelehnt"
            else latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
            try { unbindService(conn) } catch (_: Exception) { }
            result
        } catch (e: Exception) { "Fehler: $e" }
    }
}
