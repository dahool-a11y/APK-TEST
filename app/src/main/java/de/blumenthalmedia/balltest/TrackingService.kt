package de.blumenthalmedia.balltest

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Vordergrunddienst für die GPS-Aufzeichnung. Er hält die Ortung am Laufen,
 * auch wenn der Bildschirm aus ist oder eine andere App im Vordergrund steht.
 */
class TrackingService : Service() {

    private lateinit var locationManager: LocationManager
    private var updatesActive = false

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            TrackBuffer.add(location)
        }

        override fun onProviderEnabled(provider: String) {}

        override fun onProviderDisabled(provider: String) {
            if (provider == LocationManager.GPS_PROVIDER) {
                TrackBuffer.fail(2, "GPS ist am Gerät ausgeschaltet")
            }
        }

        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            createChannel()
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
            startUpdates()
        } catch (e: Exception) {
            TrackBuffer.fail(1, "GPS-Dienst konnte nicht starten: ${e.message}")
            TrackBuffer.running = false
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startUpdates() {
        if (updatesActive) return
        if (!locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            TrackBuffer.fail(2, "GPS ist am Gerät ausgeschaltet")
        }
        // Jede Sekunde, ohne Mindestabstand: die Web-App filtert selbst
        locationManager.requestLocationUpdates(
            LocationManager.GPS_PROVIDER,
            1000L,
            0f,
            listener,
            Looper.getMainLooper()
        )
        updatesActive = true
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "GPS-Aufzeichnung",
            NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_track)
            .setContentTitle("Fahrtprofil")
            .setContentText("Fahrt wird aufgezeichnet")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .build()
    }

    /** Wird die App aus der Übersicht weggewischt, ist die Aufzeichnung ohnehin verloren: Dienst beenden. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        if (updatesActive) {
            try {
                locationManager.removeUpdates(listener)
            } catch (_: Exception) {
            }
            updatesActive = false
        }
        TrackBuffer.running = false
        super.onDestroy()
    }

    private companion object {
        const val CHANNEL_ID = "tracking"
        const val NOTIFICATION_ID = 1
    }
}
