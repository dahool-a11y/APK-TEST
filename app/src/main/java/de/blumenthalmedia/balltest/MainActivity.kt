package de.blumenthalmedia.balltest

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import java.io.File
import kotlin.math.max

/**
 * Hülle um die Fahrtprofil-Web-App. Die Web-Dateien liegen als Assets in der APK
 * (Ordner "www") und werden über eine https-Adresse ausgeliefert. Dadurch gilt die
 * Seite als sicherer Kontext, und IndexedDB sowie alle Skripte funktionieren offline.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var banner: UpdateBanner
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var lastUpdateCheck = 0L

    private val filePicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCallback = null
    }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            if (result[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
                startTrackingService()
            } else {
                TrackBuffer.fail(1, "Genauer Standortzugriff wurde verweigert")
            }
        }

    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            // Erst die Fahrtenliste schließen, falls sie offen ist
            webView.evaluateJavascript(CLOSE_TRIPS_JS) { result ->
                if (result != "\"closed\"") {
                    // Läuft eine Aufzeichnung, bleibt die App im Hintergrund erhalten
                    if (TrackBuffer.running) moveTaskToBack(true) else finish()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bg = Color.parseColor("#070b10")
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(bg),
            navigationBarStyle = SystemBarStyle.dark(bg)
        )

        val root = FrameLayout(this).apply { setBackgroundColor(bg) }
        setContentView(root)

        // Platz für Statusleiste, Navigationsleiste, Display-Ausschnitt und Tastatur lassen
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, max(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        webView = createWebView(bg)
        root.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )

        banner = UpdateBanner(this, lifecycleScope)
        val margin = (12 * resources.displayMetrics.density).toInt()
        root.addView(
            banner.view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
            ).apply { setMargins(margin, margin, margin, margin) }
        )

        onBackPressedDispatcher.addCallback(this, backCallback)
        webView.loadUrl(START_URL)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(bg: Int): WebView {
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        return WebView(this).apply {
            setBackgroundColor(bg)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // aktiviert auch IndexedDB
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportZoom(false)

            addJavascriptInterface(NativeBridge(this@MainActivity), "AndroidBridge")

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    // Alles außerhalb der App (z. B. der OSM-Link) im Browser öffnen
                    if (request.url.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (_: Exception) {
                    }
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams
                ): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    return try {
                        filePicker.launch(arrayOf("*/*"))
                        true
                    } catch (e: Exception) {
                        fileCallback = null
                        callback.onReceiveValue(null)
                        false
                    }
                }

                override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                    Log.d("Fahrtprofil", "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                    return true
                }
            }

            if (this@MainActivity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
                WebView.setWebContentsDebuggingEnabled(true)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Update-Prüfung beim Start und danach höchstens alle 10 Minuten
        val now = System.currentTimeMillis()
        if (now - lastUpdateCheck > 10 * 60 * 1000) {
            lastUpdateCheck = now
            banner.checkNow()
        }
    }

    override fun onDestroy() {
        if (isFinishing) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    /* ---------- GPS-Aufzeichnung ---------- */

    fun beginTracking() {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (fine) {
            startTrackingService()
            return
        }
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        permissionLauncher.launch(permissions.toTypedArray())
    }

    private fun startTrackingService() {
        TrackBuffer.reset()
        TrackBuffer.running = true
        ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java))
    }

    fun endTracking() {
        stopService(Intent(this, TrackingService::class.java))
        TrackBuffer.running = false
    }

    fun setKeepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /* ---------- Export ---------- */

    /** Schreibt den Text in eine Cache-Datei und öffnet das Teilen-Menü. */
    fun shareText(name: String, mime: String, text: String) {
        try {
            val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "export.json" }
            val dir = File(cacheDir, "exports").apply { mkdirs() }
            val file = File(dir, safe)
            file.writeText(text)
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, safe)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            runOnUiThread { startActivity(Intent.createChooser(send, "Fahrt exportieren")) }
        } catch (e: Exception) {
            Log.e("Fahrtprofil", "Export fehlgeschlagen", e)
        }
    }

    private companion object {
        const val START_URL = "https://appassets.androidplatform.net/assets/www/index.html"
        const val CLOSE_TRIPS_JS =
            "(function(){var d=document.getElementById('tripsDrawer');" +
                "if(d&&!d.hidden){document.getElementById('tripsClose').click();return 'closed';}" +
                "return 'none';})()"
    }
}
