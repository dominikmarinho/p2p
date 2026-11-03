plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android {
    namespace = "com.highpass.player"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.highpass.player"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "ENGINE_URL", "\"${providers.gradleProperty("engineUrl").getOrElse("https://p2p.remoto.api.br").trimEnd('/')}\"")
        buildConfigField("String", "XUI_BASE_URL", "\"http://xuione.remoto.api.br\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildTypes { release { isMinifyEnabled = false } }
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
