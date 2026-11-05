plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android {
    namespace = "com.highpass.player"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.highpass.player"
        minSdk = 26
        targetSdk = 35
        versionCode = providers.gradleProperty("clientVersionCode").getOrElse("2").toInt()
        versionName = providers.gradleProperty("clientVersionName").getOrElse("1.3.7")
        buildConfigField("String", "ENGINE_URL", "\"${providers.gradleProperty("engineUrl").getOrElse("https://p2p.remoto.api.br").trimEnd('/')}\"")
        buildConfigField("String", "XUI_BASE_URL", "\"http://xuione.remoto.api.br\"")
    }
    flavorDimensions += "transport"
    productFlavors {
        create("http") { dimension = "transport"; buildConfigField("String", "TRANSPORT", "\"http\""); manifestPlaceholders["appLabel"] = "Highpass HTTP" }
        create("p2p") { dimension = "transport"; applicationIdSuffix = ".p2p"; buildConfigField("String", "TRANSPORT", "\"p2p\""); manifestPlaceholders["appLabel"] = "Highpass P2P" }
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    signingConfigs {
        create("installedIdentity") {
            val signingPath = System.getenv("ANDROID_SIGNING_STORE_FILE") ?: System.getProperty("user.home") + "/.android/debug.keystore"
            if (file(signingPath).exists()) {
                storeFile = file(signingPath)
                storePassword = System.getenv("ANDROID_SIGNING_STORE_PASSWORD") ?: "android"
                keyAlias = System.getenv("ANDROID_SIGNING_KEY_ALIAS") ?: "androiddebugkey"
                keyPassword = System.getenv("ANDROID_SIGNING_KEY_PASSWORD") ?: "android"
            }
        }
    }
    buildTypes { release { isMinifyEnabled = false; if (signingConfigs.getByName("installedIdentity").storeFile != null) signingConfig = signingConfigs.getByName("installedIdentity"); isDebuggable = false } }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-exoplayer-hls:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")
    testImplementation("junit:junit:4.13.2")
}
