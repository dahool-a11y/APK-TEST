package de.blumenthalmedia.balltest

import android.location.Location
import org.json.JSONObject

/**
 * Zwischenspeicher für GPS-Punkte. Der [TrackingService] schreibt hinein, die
 * Web-App holt die Punkte über die Brücke ab ([drain]). So gehen keine Punkte
 * verloren, wenn die Web-Oberfläche im Hintergrund pausiert ist.
 */
object TrackBuffer {
    private val lock = Any()
    private val points = ArrayList<String>()
    private var errorCode = 0
    private var errorMessage = ""

    @Volatile
    var running = false

    fun reset() = synchronized(lock) {
        points.clear()
        errorCode = 0
        errorMessage = ""
    }

    fun add(l: Location) {
        val o = JSONObject()
        o.put("lat", l.latitude)
        o.put("lng", l.longitude)
        o.put("alt", if (l.hasAltitude()) l.altitude else JSONObject.NULL)
        o.put("acc", if (l.hasAccuracy()) l.accuracy.toDouble() else JSONObject.NULL)
        o.put("spd", if (l.hasSpeed()) l.speed.toDouble() else JSONObject.NULL)
        o.put("hdg", if (l.hasBearing()) l.bearing.toDouble() else JSONObject.NULL)
        o.put("t", l.time)
        synchronized(lock) { points.add(o.toString()) }
    }

    /** Fehler, der beim nächsten Abholen an die Web-App gemeldet wird (1 = verweigert, 2 = nicht verfügbar). */
    fun fail(code: Int, message: String) = synchronized(lock) {
        errorCode = code
        errorMessage = message
    }

    /** Liefert alle Punkte ab Index [from] als JSON: {"next":N,"points":[...],"error":..}. */
    fun drain(from: Int): String = synchronized(lock) {
        val start = from.coerceIn(0, points.size)
        val sb = StringBuilder()
        sb.append("{\"next\":").append(points.size).append(",\"points\":[")
        for (i in start until points.size) {
            if (i > start) sb.append(',')
            sb.append(points[i])
        }
        sb.append(']')
        if (errorCode != 0) {
            sb.append(",\"error\":").append(errorCode)
            sb.append(",\"message\":").append(JSONObject.quote(errorMessage))
            errorCode = 0
        }
        sb.append('}')
        sb.toString()
    }
}
