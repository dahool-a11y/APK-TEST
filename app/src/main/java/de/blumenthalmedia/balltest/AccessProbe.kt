package de.blumenthalmedia.balltest

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.IBinder
import androidx.core.content.ContextCompat
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Reine Lese-Sonde für die Fahrzeug-Anbindung des Radios.
 *
 * Sie beantwortet eine einzige Frage: Gibt es auf diesem Gerät einen Kanal, über den
 * eine fremde App Fahrzeugdaten lesen darf? Dafür werden nur Metadaten und Lesewege
 * benutzt – nichts wird gestartet, geschrieben oder gesendet.
 *
 * Bewusst NICHT enthalten (und bitte auch nicht ergänzen):
 *  - kein Öffnen von /dev/tty* (Lesen würde dem MCU-Dienst Bytes aus dem Puffer stehlen)
 *  - kein resolver.insert/update/delete/call (nur query)
 *  - kein sendBroadcast / startService / startActivity
 *  - kein binder.transact mit Nutzdaten
 *  - bindService ausschließlich mit flags = 0, also ohne BIND_AUTO_CREATE
 *
 * Der einzige IPC-Vorgang ist das Erfragen des Schnittstellennamens. Das ist der
 * Standard-Befehl INTERFACE_TRANSACTION, den das Binder-System selbst beantwortet
 * (er wird von asInterface() bei jeder normalen Bindung genutzt) und der keine
 * Nutzdaten überträgt.
 */
class AccessProbe(
    private val ctx: Context,
    private val candidates: List<String> = emptyList()
) {

    private val pm = ctx.packageManager

    /** Hersteller-Familien dieses Radios (HCN) und die Sprachassistenten (TXZ). */
    private val families = listOf("com.hcn.", "com.txznet.")

    private val interesting = Regex(
        "can|car|vehicle|obd|mcu|ignit|light|door|speed|rpm|fuel|temp|acc",
        RegexOption.IGNORE_CASE
    )

    fun report(): String {
        val sb = StringBuilder()
        sb.appendLine("== Zugriffs-Sonde (nur lesend) ==")
        sb.appendLine("Gelesen werden: Paket-Metadaten, Provider-Abfragen (SELECT), Dienst-Bindungen")
        sb.appendLine("ohne Start (flags=0) und der Schnittstellenname.")
        sb.appendLine("Nicht ausgeführt: Ports öffnen, Schreibzugriffe, Broadcasts, Dienst-Starts,")
        sb.appendLine("Binder-Transaktionen mit Nutzdaten, Aktivitäts-Starts.")
        sb.appendLine()

        val pkgs = try {
            packages()
        } catch (e: Throwable) {
            emptyList()
        }

        safe(sb, "Pakete") {
            sb.appendLine("-- Pakete (${pkgs.size}) --")
            pkgs.forEach { pkg ->
                val label = try {
                    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
                } catch (e: Exception) {
                    "?"
                }
                sb.appendLine("   $pkg  \"$label\"")
                permissions(sb, pkg)
            }
        }
        sb.appendLine()

        safe(sb, "Dienste") {
            val budget = intArrayOf(8)
            sb.appendLine("-- Dienste (passiv gebunden, höchstens 8) --")
            val ordered = pkgs.sortedBy { if (it == "com.hcn.autocan") 0 else 1 }
            ordered.forEach { services(sb, it, budget) }
        }
        sb.appendLine()

        safe(sb, "Provider") {
            sb.appendLine("-- Provider (nur SELECT) --")
            pkgs.forEach { providers(sb, it) }
        }
        sb.appendLine()

        safe(sb, "Kandidaten") {
            sb.appendLine("-- Kandidaten-Actions (nur Abfrage, nichts gesendet) --")
            checkCandidates(sb)
        }
        sb.appendLine()

        safe(sb, "Startbare Apps") { launcher(sb) }
        sb.appendLine()

        safe(sb, "Gerät") { device(sb) }
        return sb.toString()
    }

    /** Ein fehlerhafter Abschnitt darf den restlichen Bericht nicht mitreißen. */
    private inline fun safe(sb: StringBuilder, name: String, body: () -> Unit) {
        try {
            body()
        } catch (e: Throwable) {
            sb.appendLine("   ($name fehlgeschlagen: ${e.javaClass.simpleName}: ${e.message?.take(80)})")
        }
    }

    /* ---------- Pakete und Berechtigungen ---------- */

    private fun packages(): List<String> =
        pm.getInstalledPackages(0)
            .map { it.packageName }
            .filter { name -> families.any { name.startsWith(it) } }
            .sorted()

    private fun permissions(sb: StringBuilder, pkg: String) {
        val info = try {
            pm.getPackageInfo(pkg, PackageManager.GET_PERMISSIONS)
        } catch (e: Exception) {
            sb.appendLine("      (nicht lesbar: ${e.javaClass.simpleName})")
            return
        }
        val requested = info.requestedPermissions ?: return
        // Eigene Berechtigungen der Hersteller sind immer interessant,
        // Standard-Berechtigungen nur, wenn sie nach Fahrzeug klingen.
        val shown = requested.filter { p ->
            !p.startsWith("android.permission.") || interesting.containsMatchIn(p)
        }
        shown.forEach { p ->
            val granted = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED
            sb.appendLine("      ${if (granted) "[+]" else "[-]"} $p")
        }
    }

    /* ---------- Dienste: nur Metadaten und passives Binden ---------- */

    private fun services(sb: StringBuilder, pkg: String, budget: IntArray) {
        val info = try {
            pm.getPackageInfo(pkg, PackageManager.GET_SERVICES)
        } catch (e: Exception) {
            return
        }
        val raw = info.services ?: return
        if (raw.isEmpty()) return
        // Fahrzeugnahe Dienste zuerst, damit das Bindungs-Budget nicht an
        // belanglosen Diensten hängen bleibt.
        val list = raw.sortedBy { if (interesting.containsMatchIn(it.name)) 0 else 1 }
        list.take(12).forEach { s ->
            val permission = s.permission ?: "-"
            sb.appendLine("   ${short(pkg, s.name)}  exported=${s.exported}  permission=$permission")
            val worth = s.exported && (permission == "-" || interesting.containsMatchIn(s.name))
            if (worth && budget[0] > 0) {
                budget[0]--
                sb.appendLine("      passiv: ${bindPassive(pkg, s.name)}")
            }
        }
        if (list.size > 12) sb.appendLine("   … ${list.size - 12} weitere")
    }

    /**
     * Bindet ohne BIND_AUTO_CREATE. Ist der Dienst nicht ohnehin gestartet, passiert
     * nichts – genau das ist gewollt.
     */
    private fun bindPassive(pkg: String, cls: String): String {
        val latch = CountDownLatch(1)
        var text = "nicht gestartet (nur passiv geprüft, kein Start)"
        var bound = false
        val conn = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
                text = if (binder == null) "verbunden, ohne Binder" else descriptor(binder)
                latch.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName?) {}
        }
        return try {
            bound = ctx.bindService(Intent().setComponent(ComponentName(pkg, cls)), conn, 0)
            if (!bound) {
                "bindService abgelehnt (keine Berechtigung oder Dienst gesperrt)"
            } else {
                latch.await(1200, TimeUnit.MILLISECONDS)
                text
            }
        } catch (e: SecurityException) {
            "geschützt: ${e.message?.take(90)}"
        } catch (e: Exception) {
            "Fehler: ${e.javaClass.simpleName}: ${e.message?.take(80)}"
        } finally {
            if (bound) {
                try { ctx.unbindService(conn) } catch (_: Exception) { }
            }
        }
    }

    private fun descriptor(binder: IBinder): String = try {
        val name = binder.interfaceDescriptor
        "Schnittstelle: ${name ?: "(ohne Namen)"}"
    } catch (e: Exception) {
        "Schnittstelle nicht lesbar: ${e.javaClass.simpleName}"
    }

    /* ---------- Provider: ausschließlich SELECT ---------- */

    private fun providers(sb: StringBuilder, pkg: String) {
        val info = try {
            pm.getPackageInfo(pkg, PackageManager.GET_PROVIDERS)
        } catch (e: Exception) {
            return
        }
        info.providers?.forEach { p ->
            val authority = p.authority ?: return@forEach
            sb.appendLine(
                "   $authority  exported=${p.exported}  read=${p.readPermission ?: "-"}" +
                    "  write=${p.writePermission ?: "-"}"
            )
            if (!p.exported) return@forEach
            val readPermission = p.readPermission
            if (readPermission != null &&
                ContextCompat.checkSelfPermission(ctx, readPermission) != PackageManager.PERMISSION_GRANTED
            ) {
                sb.appendLine("      Abfrage: übersprungen (Leseberechtigung fehlt)")
                return@forEach
            }
            sb.appendLine("      Abfrage: ${queryFirst(authority)}")
        }
    }

    /** Öffnet einen Cursor und liest höchstens eine Zeile. Kein Schreibzugriff möglich. */
    private fun queryFirst(authority: String): String {
        val uri = Uri.parse("content://$authority")
        var result = "keine Antwort (Zeitüberschreitung)"
        val worker = Thread {
            result = try {
                ctx.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    val columns = cursor.columnNames
                    val head = "Spalten: " + columns.take(8).joinToString(",") +
                        (if (columns.size > 8) " …" else "")
                    if (!cursor.moveToFirst()) {
                        "0 Zeilen · $head"
                    } else {
                        val values = (0 until minOf(columns.size, 6)).map { i ->
                            try {
                                when (cursor.getType(i)) {
                                    Cursor.FIELD_TYPE_BLOB -> "<binär>"
                                    Cursor.FIELD_TYPE_NULL -> "null"
                                    else -> cursor.getString(i)?.take(40) ?: "null"
                                }
                            } catch (e: Exception) {
                                "?"
                            }
                        }
                        "1. Zeile: ${values.joinToString(" | ")} · $head"
                    }
                } ?: "kein Cursor zurückgegeben"
            } catch (e: SecurityException) {
                "geschützt: ${e.message?.take(90)}"
            } catch (e: Exception) {
                "Fehler: ${e.javaClass.simpleName}: ${e.message?.take(80)}"
            }
        }
        worker.isDaemon = true
        worker.start()
        worker.join(2500)
        return result
    }

    /* ---------- Kandidaten-Actions: nur Abfrage der Registrierungen ---------- */

    private fun checkCandidates(sb: StringBuilder) {
        val list = candidates.distinct().filter { it.length in 8..90 }.take(150)
        if (list.isEmpty()) {
            sb.appendLine("   (keine Kandidaten aus dem APK-Text gefunden)")
            return
        }
        var hits = 0
        list.forEach { action ->
            val receivers = try {
                pm.queryBroadcastReceivers(Intent(action), 0)
            } catch (e: Exception) {
                emptyList()
            }
            val foundServices = try {
                pm.queryIntentServices(Intent(action), 0)
            } catch (e: Exception) {
                emptyList()
            }
            if (receivers.isEmpty() && foundServices.isEmpty()) return@forEach
            hits++
            sb.appendLine("   $action")
            receivers.forEach receiver@{ r ->
                val a = r.activityInfo ?: return@receiver
                sb.appendLine(
                    "      Empfänger ${short(a.packageName, a.name)}" +
                        " exported=${a.exported} permission=${a.permission ?: "-"}"
                )
            }
            foundServices.forEach service@{ r ->
                val s = r.serviceInfo ?: return@service
                sb.appendLine(
                    "      Dienst ${short(s.packageName, s.name)}" +
                        " exported=${s.exported} permission=${s.permission ?: "-"}"
                )
            }
        }
        sb.appendLine("   -> $hits von ${list.size} Kandidaten sind überhaupt registriert")
    }

    /* ---------- Startbare Apps: beantwortet "welches Paket ist CARINFO?" ---------- */

    private fun launcher(sb: StringBuilder) {
        sb.appendLine("-- Startbare Apps mit Fahrzeugbezug --")
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved = try {
            pm.queryIntentActivities(intent, 0)
        } catch (e: Exception) {
            emptyList()
        }
        val relevant = Regex(
            "can|car|auto|vehicle|info|obd|hcn|txz|essgoo|radio|setting|dienst|service",
            RegexOption.IGNORE_CASE
        )
        var shown = 0
        resolved.forEach app@{ r ->
            val a = r.activityInfo ?: return@app
            val label = try {
                a.loadLabel(pm).toString()
            } catch (e: Exception) {
                "?"
            }
            if (!relevant.containsMatchIn(label) && !relevant.containsMatchIn(a.packageName)) {
                return@app
            }
            sb.appendLine("   \"$label\"  ${a.packageName}")
            shown++
        }
        if (shown == 0) sb.appendLine("   (keine gefunden)")
    }

    /* ---------- Gerät: Funk und serielle Knoten (nur Metadaten) ---------- */
    private fun device(sb: StringBuilder) {
        fun feature(name: String) = if (pm.hasSystemFeature(name)) "ja" else "nein"
        sb.appendLine("-- Funk und Anschlüsse --")
        sb.appendLine("   USB-Host: ${feature(PackageManager.FEATURE_USB_HOST)}")
        sb.appendLine("   USB-Zubehör: ${feature(PackageManager.FEATURE_USB_ACCESSORY)}")
        sb.appendLine("   Bluetooth: ${feature(PackageManager.FEATURE_BLUETOOTH)}")
        sb.appendLine("   Bluetooth LE: ${feature(PackageManager.FEATURE_BLUETOOTH_LE)}")
        sb.appendLine()
        sb.appendLine("-- Serielle Knoten (nur Namen und Rechte, nicht geöffnet) --")
        val nodes = File("/dev").listFiles()
            ?.filter { it.name.startsWith("tty") }
            ?.sortedBy { it.name }
            .orEmpty()
        if (nodes.isEmpty()) {
            sb.appendLine("   (nichts sichtbar)")
        } else {
            nodes.forEach {
                sb.appendLine(
                    "   ${it.path}  lesbar=${it.canRead()} schreibbar=${it.canWrite()}"
                )
            }
        }
    }

    private fun short(pkg: String, cls: String): String = cls.removePrefix(pkg)
}
