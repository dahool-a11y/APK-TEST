package de.blumenthalmedia.balltest

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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
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
import kotlin.math.abs
import kotlin.random.Random

// Ballfarben (Highlight, Mitte, Rand). Wird beim Update-Test geändert.
private val BallColors = listOf(Color(0xFFFFE082), Color(0xFFFF7043), Color(0xFFBF360C))

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
    val gravity = with(density) { 2400.dp.toPx() }      // px / s²
    val kickSpeed = with(density) { 1500.dp.toPx() }    // Absprunggeschwindigkeit
    val minBounce = with(density) { 500.dp.toPx() }     // darunter: Auto-Kick

    var size by remember { mutableStateOf(IntSize.Zero) }
    var x by remember { mutableFloatStateOf(0f) }
    var y by remember { mutableFloatStateOf(0f) }
    var vx by remember { mutableFloatStateOf(0f) }
    var vy by remember { mutableFloatStateOf(0f) }
    var squash by remember { mutableFloatStateOf(0f) }   // 0..1, kurz nach dem Aufprall
    var fps by remember { mutableFloatStateOf(0f) }
    var bounces by remember { mutableFloatStateOf(0f) }

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
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                if (last != 0L) {
                    val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
                    if (dt > 0f) fps = fps * 0.9f + (1f / dt) * 0.1f

                    val floor = size.height - radius
                    val rightWall = size.width - radius

                    vy += gravity * dt
                    y += vy * dt
                    x += vx * dt

                    if (x < radius) { x = radius; vx = abs(vx) }
                    if (x > rightWall) { x = rightWall; vx = -abs(vx) }

                    if (y >= floor) {
                        y = floor
                        vy = -vy * 0.85f
                        if (abs(vy) < minBounce) vy = -kickSpeed
                        squash = 1f
                        bounces += 1f
                    }
                    squash = (squash - dt * 4f).coerceAtLeast(0f)
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
                    // Tipp = zusätzlicher Schubs
                    vy = -kickSpeed * 1.2f
                    vx = (if (Random.nextBoolean()) 1 else -1) * with(density) { Random.nextInt(250, 600).dp.toPx() }
                }
            }
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val floor = size.height - radius
            val heightRatio = (1f - ((floor - y) / floor)).coerceIn(0f, 1f)

            // Schatten am Boden: größer und kräftiger, je näher der Ball am Boden ist
            val shadowW = radius * (0.8f + 1.4f * heightRatio)
            drawOval(
                color = Color.Black.copy(alpha = 0.15f + 0.30f * heightRatio),
                topLeft = Offset(x - shadowW, size.height - radius * 0.35f),
                size = Size(shadowW * 2f, radius * 0.5f)
            )

            // Ball mit leichter Stauchung beim Aufprall
            val sx = 1f + 0.35f * squash
            val sy = 1f - 0.30f * squash
            val rw = radius * sx
            val rh = radius * sy
            val cy = y + (radius - rh) // Unterkante bleibt am Boden
            drawOval(
                brush = Brush.radialGradient(
                    colors = BallColors,
                    center = Offset(x - rw * 0.3f, cy - rh * 0.3f),
                    radius = radius * 1.6f
                ),
                topLeft = Offset(x - rw, cy - rh),
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
                text = "Setup funktioniert ✔",
                fontSize = 24.sp,
                color = Color.White
            )
            Text(
                text = "Version ${Updater.installedVersionName(context)} · Tippen = Extra-Sprung",
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

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = Color.Black.copy(alpha = 0.40f)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            when (val s = state) {
                UpdateState.Idle -> Text("Update-Prüfung bereit", color = Color.White)
                UpdateState.Checking -> Text("Suche nach Updates …", color = Color.White)
                UpdateState.UpToDate -> {
                    Text("Du hast die neueste Version ✔", color = Color.White)
                    OutlinedButton(onClick = { check() }, modifier = Modifier.padding(top = 8.dp)) {
                        Text("Erneut prüfen")
                    }
                }
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
                is UpdateState.Error -> {
                    Text("Update-Prüfung fehlgeschlagen: ${s.message}", color = Color(0xFFFF8A80))
                    OutlinedButton(onClick = { check() }, modifier = Modifier.padding(top = 8.dp)) {
                        Text("Erneut versuchen")
                    }
                }
            }
        }
    }
}
