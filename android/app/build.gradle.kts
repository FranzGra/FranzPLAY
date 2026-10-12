plugins {
    id("com.android.application")
}

// The release signing key comes from environment variables (GitHub secrets in
// CI), never from the repository. Without them the release APK is signed with
// the temporary debug key: it installs, but a later APK signed with another
// key cannot update it. See docs/app-android.md.
val keystoreFile: String? = System.getenv("FRANZPLAY_KEYSTORE_FILE")

android {
    namespace = "io.github.franzgra.franzplay"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.franzgra.franzplay"
        minSdk = 26 // Android 8.0
        targetSdk = 36
        // CI passes its run number, so every new APK can update the old one.
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = "1.0.$versionCode"
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = file(keystoreFile)
                storePassword = System.getenv("FRANZPLAY_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("FRANZPLAY_KEY_ALIAS")
                keyPassword = System.getenv("FRANZPLAY_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        warningsAsErrors = false
        abortOnError = true
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
