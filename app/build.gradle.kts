plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Auf GitHub steigt die Versionsnummer mit jedem Build automatisch (Run-Nummer).
// Lokal in Android Studio ist es immer 1.
val buildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

android {
    namespace = "de.blumenthalmedia.balltest"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.blumenthalmedia.balltest"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "0.1.$buildNumber"
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

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
}
