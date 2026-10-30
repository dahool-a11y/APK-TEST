plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Auf GitHub steigt die Versionsnummer mit jedem Build automatisch (Run-Nummer).
// Lokal in Android Studio ist es immer 1.
val buildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

// Die Web-App liegt im Ordner fahrtprofil/ (Repo-Wurzel) und wird beim Build
// als Asset "www" in die APK kopiert. Es gibt nur eine Quelle, keine zweite Kopie.
val webOut = File(layout.buildDirectory.get().asFile, "generated/web")
val copyWebApp = tasks.register<Copy>("copyWebApp") {
    from(rootProject.file("fahrtprofil")) {
        exclude("tools/**", "README.md")
    }
    into(File(webOut, "www"))
    includeEmptyDirs = false
}

android {
    namespace = "de.blumenthalmedia.balltest"
    compileSdk = 35

    defaultConfig {
        // Die Paket-ID bleibt bewusst "balltest": Nur so ersetzt die neue App die
        // alte Ball-App beim Update, statt als zweite App daneben zu landen.
        applicationId = "de.blumenthalmedia.balltest"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "0.2.$buildNumber"
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(webOut)
        }
    }

    // TESTSCHLÜSSEL: liegt bewusst im Repo, damit jeder Build (lokal und auf GitHub)
    // mit demselben Key signiert wird und Android Updates annimmt.
    // Für eine echte Veröffentlichung wird er durch einen geheimen Key ersetzt.
    signingConfigs {
        create("shared") {
            storeFile = file("shared-debug.keystore")
            storePassword = "balltest123"
            keyAlias = "balltest"
            keyPassword = "balltest123"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("shared")
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Alle Tasks, die Assets lesen, müssen erst die Web-App kopieren lassen
tasks.configureEach {
    if (name != "copyWebApp" && (name.startsWith("merge") && name.endsWith("Assets"))) {
        dependsOn(copyWebApp)
    }
}
tasks.named("preBuild") { dependsOn(copyWebApp) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
