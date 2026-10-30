package de.blumenthalmedia.balltest

import android.app.Activity
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

// Ballfarben (Highlight, Mitte, Rand)
private val BallColors = listOf(Color(0xFF9BE7FF), Color(0xFF2196F3), Color(0xFF0D3C8C))

// Erdbeschleunigung in m/s²
private const val G = 9.81f

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                BounceScreen()
            }
        }
    }
}

@Composable
fun BounceScreen() {
    val context = LocalContext.current
    val density = LocalDensity.current
    val radius = with(density) { 28.dp.toPx() }
    // Umrechnung: 1 m/s² Sensorwert = so viele px/s² auf dem Bildschirm
    val accScale = with(density) { 2400.dp.toPx() } / G
    val kickSpeed = with(density) { 1500.dp.toPx() }    // Referenz für Aufprallstärke / Stoß
    val minBounce = with(density) { 500.dp.toPx() }     // nur im Fallback ohne Sensor
    val restitution = 0.8f                              // wie stark der Ball zurückfedert

    var size by remember { mutableStateOf(IntSize.Zero) }
    var x by remember { mutableFloatStateOf(0f) }
    var y by remember { mutableFloatStateOf(0f) }
    var vx by remember { mutableFloatStateOf(0f) }
    var vy by remember { mutableFloatStateOf(0f) }
    var squashH by remember { mutableFloatStateOf(0f) }  // Stauchung nach Aufprall an linker/rechter Wand
    var squashV by remember { mutableFloatStateOf(0f) }  // Stauchung nach Aufprall an Boden/Decke
    var impactNx by remember { mutableFloatStateOf(0f) } // Richtung weg von der getroffenen Wand
    var impactNy by remember { mutableFloatStateOf(0f) }
    var fps by remember { mutableFloatStateOf(0f) }
    var bounces by remember { mutableFloatStateOf(0f) }

    // Sensor: Beschleunigung in Bildschirmrichtung (m/s²), x nach rechts, y nach unten
    var hasSensor by remember { mutableStateOf(true) }
    var gx by remember { mutableFloatStateOf(0f) }
    var gy by remember { mutableFloatStateOf(G) }

    DisposableEffect(Unit) {
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (sensor == null) {
            hasSensor = false
            onDispose { }
        } else {
            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    val ax = event.values[0]
                    val ay = event.values[1]
                    @Suppress("DEPRECATION")
                    val rotation = (context as? Activity)?.windowManager?.defaultDisplay?.rotation ?: 0
                    // Sensorachsen sind fest am Gerät, deshalb je nach Bildschirmdrehung umrechnen
                    val tx: Float
                    val ty: Float
                    when (rotation) {
                        1 -> { tx = ay; ty = ax }      // 90°
                        2 -> { tx = ax; ty = -ay }     // 180°
                        3 -> { tx = -ay; ty = -ax }    // 270°
                        else -> { tx = -ax; ty = ay }  // 0° (Hochformat)
                    }
                    // leichte Glättung gegen Zittern
                    gx += (tx - gx) * 0.25f
                    gy += (ty - gy) * 0.25f
                }

                override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
            }
            sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
            onDispose { sm.unregisterListener(listener) }
        }
    }

    // Startposition, sobald die Größe bekannt ist
    LaunchedEffect(size) {
        if (size.width > 0 && x == 0f && y == 0f) {
            x = size.width / 2f
            y = size.height * 0.25f
            vx = with(density) { 380.dp.toPx() }
        }
    }

    // Physik-Schleife, ein Schritt pro Frame
    LaunchedEffect(size) {
        if (size.width == 0) return@LaunchedEffect

        fun hit(speed: Float, nx: Float, ny: Float) {
            val strength = (speed / kickSpeed).coerceIn(0f, 1f)
            if (strength < 0.12f) return
            if (nx != 0f) squashH = maxOf(squashH, strength) else squashV = maxOf(squashV, strength)
            impactNx = nx
            impactNy = ny
            bounces += 1f
        }

        var last = 0L
        while (true) {
            withFrameNanos { now ->
                if (last != 0L) {
                    val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
                    if (dt > 0f) fps = fps * 0.9f + (1f / dt) * 0.1f

                    // Beschleunigung aus dem Sensor, leichte Dämpfung damit der Ball ausrollt
                    vx += gx * accScale * dt
                    vy += gy * accScale * dt
                    val damp = (1f - 0.35f * dt).coerceAtLeast(0f)
                    vx *= damp
                    vy *= damp
                    x += vx * dt
                    y += vy * dt

                    val left = radius
                    val right = size.width - radius
                    val top = radius
                    val bottom = size.height - radius

                    if (x < left) {
                        x = left
                        if (vx < 0f) { hit(-vx, 1f, 0f); vx = -vx * restitution }
                    }
                    if (x > right) {
                        x = right
                        if (vx > 0f) { hit(vx, -1f, 0f); vx = -vx * restitution }
                    }
                    if (y < top) {
                        y = top
                        if (vy < 0f) { hit(-vy, 0f, 1f); vy = -vy * restitution }
                    }
                    if (y > bottom) {
                        y = bottom
                        if (vy > 0f) { hit(vy, 0f, -1f); vy = -vy * restitution }
                        // Ohne Sensor (z. B. Emulator) springt der Ball weiter von selbst
                        if (!hasSensor && abs(vy) < minBounce) vy = -kickSpeed
                    }

                    squashH = (squashH - dt * 4f).coerceAtLeast(0f)
                    squashV = (squashV - dt * 4f).coerceAtLeast(0f)
                }
                last = now
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF0F2027), Color(0xFF203A43), Color(0xFF2C5364))))
            .onSizeChanged { size = it }
            .pointerInput(Unit) {
                detectTapGestures {
                    // Tipp = Stoß in zufällige Richtung
                    val angle = Random.nextFloat() * 2f * PI.toFloat()
                    vx += cos(angle) * kickSpeed * 0.7f
                    vy += sin(angle) * kickSpeed * 0.7f
                }
            }
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            // Ball mit Stauchung beim Aufprall
            val sx = 1f + 0.35f * squashV - 0.30f * squashH
            val sy = 1f - 0.30f * squashV + 0.35f * squashH
            val rw = radius * sx
            val rh = radius * sy
            // Mittelpunkt verschieben, damit die getroffene Seite an der Wand bleibt
            val cx = x - impactNx * (radius - rw)
            val cy = y - impactNy * (radius - rh)

            // Schatten: leicht in Richtung der Schwerkraft versetzt
            val ox = (gx / G).coerceIn(-1.5f, 1.5f) * radius * 0.35f
            val oy = (gy / G).coerceIn(-1.5f, 1.5f) * radius * 0.35f
            drawCircle(
                color = Color.Black.copy(alpha = 0.28f),
                radius = radius * 1.02f,
                center = Offset(cx + ox, cy + oy)
            )

            drawOval(
                brush = Brush.radialGradient(
                    colors = BallColors,
                    center = Offset(cx - rw * 0.3f, cy - rh * 0.3f),
                    radius = radius * 1.6f
                ),
                topLeft = Offset(cx - rw, cy - rh),
                size = Size(rw * 2f, rh * 2f)
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Neige dein Handy",
                fontSize = 24.sp,
                color = Color.White
            )
            Text(
                text = "Version ${Updater.installedVersionName(context)} · Tippen = Stoß",
                fontSize = 14.sp,
                color = Color.White.copy(alpha = 0.75f),
                modifier = Modifier.padding(top = 6.dp)
            )
            Text(
                text = "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                fontSize = 12.sp,
                color = Color.White.copy(alpha = 0.55f),
                modifier = Modifier.padding(top = 10.dp)
            )
            Text(
                text = if (hasSensor)
                    "Neigung: ${"%.1f".format(gx)} / ${"%.1f".format(gy)} m/s²"
                else
                    "Kein Beschleunigungssensor – Ball springt von selbst",
                fontSize = 12.sp,
                color = Color.White.copy(alpha = 0.55f),
                modifier = Modifier.padding(top = 2.dp)
            )
            Text(
                text = "FPS: ${fps.toInt()} · Aufprälle: ${bounces.toInt()}",
                fontSize = 12.sp,
                color = Color.White.copy(alpha = 0.55f),
                modifier = Modifier.padding(top = 2.dp)
            )
        }

        UpdatePanel(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(16.dp)
        )
    }
}

sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val info: UpdateInfo) : UpdateState
    data class Downloading(val progress: Float) : UpdateState
    data class Ready(val file: File, val needsPermission: Boolean) : UpdateState
    data class Error(val message: String) : UpdateState
}

/**
 * Update-Hinweis: Wird nur eingeblendet, wenn es wirklich eine neuere Version gibt
 * (oder gerade geladen/installiert wird). Sonst ist nichts zu sehen.
 */
@Composable
fun UpdatePanel(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<UpdateState>(UpdateState.Idle) }
    val installed = remember { Updater.installedVersionCode(context) }

    fun check() {
        scope.launch {
            state = UpdateState.Checking
            state = try {
                val latest = Updater.fetchLatest()
                if (latest.versionCode > installed) UpdateState.Available(latest) else UpdateState.UpToDate
            } catch (e: Exception) {
                UpdateState.Error(e.message ?: "Unbekannter Fehler")
            }
        }
    }

    fun installFile(file: File) {
        if (Updater.canInstall(context)) {
            Updater.install(context, file)
            state = UpdateState.Ready(file, needsPermission = false)
        } else {
            Updater.openInstallPermissionSettings(context)
            state = UpdateState.Ready(file, needsPermission = true)
        }
    }

    fun downloadAndInstall(info: UpdateInfo) {
        scope.launch {
            try {
                state = UpdateState.Downloading(0f)
                val file = Updater.download(context, info.downloadUrl) { state = UpdateState.Downloading(it) }
                installFile(file)
            } catch (e: Exception) {
                state = UpdateState.Error(e.message ?: "Unbekannter Fehler")
            }
        }
    }

    // Beim Start automatisch prüfen
    LaunchedEffect(Unit) { check() }

    val visible = state is UpdateState.Available ||
        state is UpdateState.Downloading ||
        state is UpdateState.Ready
    if (!visible) return

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = Color.Black.copy(alpha = 0.55f)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            when (val s = state) {
                is UpdateState.Available -> {
                    Text("Update verfügbar: Build ${s.info.versionCode}", color = Color.White)
                    Button(onClick = { downloadAndInstall(s.info) }, modifier = Modifier.padding(top = 8.dp)) {
                        Text("Herunterladen und installieren")
                    }
                }
                is UpdateState.Downloading -> {
                    Text("Lade Update … ${(s.progress * 100).toInt()} %", color = Color.White)
                    LinearProgressIndicator(
                        progress = { s.progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp)
                    )
                }
                is UpdateState.Ready -> {
                    Text(
                        if (s.needsPermission)
                            "Bitte erlaube in den Einstellungen die Installation aus dieser Quelle, komm zurück und tippe erneut."
                        else
                            "Installer geöffnet. Falls nichts passiert ist, tippe erneut.",
                        color = Color.White
                    )
                    Button(onClick = { installFile(s.file) }, modifier = Modifier.padding(top = 8.dp)) {
                        Text("Jetzt installieren")
                    }
                }
                UpdateState.Idle, UpdateState.Checking, UpdateState.UpToDate, is UpdateState.Error -> Unit
            }
        }
    }
}
