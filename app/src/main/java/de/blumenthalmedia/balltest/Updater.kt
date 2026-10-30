package de.blumenthalmedia.balltest

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.pm.PackageInfoCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class UpdateInfo(val versionCode: Long, val downloadUrl: String)

/**
 * Prüft die GitHub-Release "latest" auf eine neuere Version, lädt die APK
 * herunter und startet den Android-Installer.
 *
 * Die Versionsnummer steht in den Release-Notes als "versionCode=<Zahl>"
 * (wird vom GitHub-Actions-Workflow geschrieben).
 */
object Updater {
    private const val RELEASE_API =
        "https://api.github.com/repos/dahool-a11y/APK-TEST/releases/tags/latest"

    fun installedVersionCode(context: Context): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return PackageInfoCompat.getLongVersionCode(info)
    }

    fun installedVersionName(context: Context): String {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return info.versionName ?: "?"
    }

    suspend fun fetchLatest(): UpdateInfo = withContext(Dispatchers.IO) {
        val conn = URL(RELEASE_API).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        try {
            if (conn.responseCode != 200) {
                error("GitHub antwortet mit HTTP ${conn.responseCode}")
            }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val body = json.optString("body")
            val code = Regex("versionCode=(\\d+)").find(body)?.groupValues?.get(1)?.toLong()
                ?: error("Release enthält keine Versionsnummer")

            val assets = json.getJSONArray("assets")
            var url: String? = null
            for (i in 0 until assets.length()) {
                val asset = assets.getJSONObject(i)
                if (asset.getString("name").endsWith(".apk")) {
                    url = asset.getString("browser_download_url")
                }
            }
            UpdateInfo(code, url ?: error("Release enthält keine APK"))
        } finally {
            conn.disconnect()
        }
    }

    suspend fun download(
        context: Context,
        url: String,
        onProgress: (Float) -> Unit
    ): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val target = File(dir, "update.apk")
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        try {
            if (conn.responseCode != 200) {
                error("Download fehlgeschlagen (HTTP ${conn.responseCode})")
            }
            val total = conn.contentLengthLong
            conn.inputStream.use { input ->
                target.outputStream().use { out ->
                    val buffer = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                        done += n
                        if (total > 0) onProgress(done.toFloat() / total)
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        target
    }

    fun canInstall(context: Context): Boolean =
        context.packageManager.canRequestPackageInstalls()

    fun openInstallPermissionSettings(context: Context) {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    /**
     * Installiert die APK über eine PackageInstaller-Session. Das Ergebnis kommt
     * asynchron im [InstallReceiver] an und wird in [InstallStatus] abgelegt.
     */
    fun install(context: Context, apk: File) {
        InstallStatus.message = "Installation wird vorbereitet …"
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        if (Build.VERSION.SDK_INT >= 31) {
            // Bei Updates ohne zusätzliche Rückfrage, wenn Android das erlaubt
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("update.apk", 0, apk.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val intent = Intent(context, InstallReceiver::class.java).setPackage(context.packageName)
            val pending = PendingIntent.getBroadcast(
                context,
                sessionId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            session.commit(pending.intentSender)
        }
    }
}
