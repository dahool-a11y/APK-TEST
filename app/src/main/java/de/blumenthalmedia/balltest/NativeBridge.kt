package de.blumenthalmedia.balltest

import android.webkit.JavascriptInterface

/**
 * Wird der Web-App als window.AndroidBridge bereitgestellt (siehe js/native-bridge.js).
 * Die Methoden laufen auf einem Hintergrund-Thread des WebViews, alles mit
 * Oberflächenbezug wird deshalb auf den Hauptthread verlegt.
 */
class NativeBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun startTracking() {
        activity.runOnUiThread { activity.beginTracking() }
    }

    @JavascriptInterface
    fun stopTracking() {
        activity.runOnUiThread { activity.endTracking() }
    }

    @JavascriptInterface
    fun drainPoints(from: Int): String = TrackBuffer.drain(from)

    @JavascriptInterface
    fun setKeepScreenOn(on: Boolean) {
        activity.runOnUiThread { activity.setKeepScreenOn(on) }
    }

    @JavascriptInterface
    fun shareFile(name: String, mime: String, text: String) {
        activity.shareText(name, mime, text)
    }

    @JavascriptInterface
    fun appVersion(): String = Updater.installedVersionName(activity)
}
