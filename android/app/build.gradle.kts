plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 签名只从环境变量读（CI 用仓库 Secrets 解出 keystore）；没有就产出未签名的 release APK。
val ksFile = System.getenv("ANDROID_KEYSTORE_FILE")?.takeIf { it.isNotBlank() && file(it).exists() }

// 构建期默认值（CI 从仓库变量写入；都为空 = 通用版：首次运行让用户填自己的服务器地址）。
fun env(name: String) = System.getenv(name)?.trim().orEmpty()
val defaultServer = env("CHISABOT_SERVER_URL")
val githubRepo = env("CHISABOT_GITHUB_REPO").ifEmpty { env("GITHUB_REPOSITORY") }
val updateFeed = env("CHISABOT_ANDROID_UPDATE_FEED").ifEmpty {
    if (githubRepo.isNotEmpty()) "https://github.com/$githubRepo/releases/latest/download/chisabot-android.json" else ""
}
fun quoted(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "cn.ayase.chisabot"
    compileSdk = 34

    defaultConfig {
        applicationId = "cn.ayase.chisabot"
        minSdk = 24
        targetSdk = 34
        versionCode = 204        // major*10000 + minor*100 + patch
        versionName = "0.2.4"
        buildConfigField("String", "DEFAULT_SERVER", quoted(defaultServer))
        buildConfigField("String", "UPDATE_FEED", quoted(updateFeed))
    }

    signingConfigs {
        if (ksFile != null) {
            create("release") {
                storeFile = file(ksFile)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (ksFile != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
}
