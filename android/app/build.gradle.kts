plugins { id("com.android.application") }

android {
    namespace = "pl.pichkur.tvhome"
    compileSdk = 35

    defaultConfig {
        applicationId = "pl.pichkur.tvhome"
        minSdk = 24
        targetSdk = 28 // Mi Box S runs Android 9; sideloaded, never published
        versionCode = (System.getenv("BUILD_NUMBER") ?: "1").toInt()
        versionName = "1.0"
    }

    signingConfigs {
        create("release") {
            val ks = System.getenv("CM_KEYSTORE_PATH")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("CM_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("CM_KEY_ALIAS")
                keyPassword = System.getenv("CM_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("CM_KEYSTORE_PATH") != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = false; checkReleaseBuilds = false }
}

// The home screen page (../../web) ships inside the APK as assets/web/.
val copyWeb by tasks.registering(Copy::class) {
    from(rootProject.file("../web")) { exclude("**/.gstack/**") }
    into(layout.buildDirectory.dir("generated/webassets/web"))
}
android.sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/webassets"))
tasks.named("preBuild") { dependsOn(copyWeb) }
