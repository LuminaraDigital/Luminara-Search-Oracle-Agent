import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
  alias(libs.plugins.ksp)
  alias(libs.plugins.room3)
  alias(libs.plugins.detekt)
  alias(libs.plugins.ktlint)
}

val defaultVersionCode = 1
val defaultVersionName = "1.0.2"

val versionCodeOverride: Int? =
  (providers.gradleProperty("luminara.versionCode").orNull ?: System.getenv("LUMINARA_VERSION_CODE"))
    ?.trim()
    ?.toIntOrNull()

val versionNameOverride: String? =
  (providers.gradleProperty("luminara.versionName").orNull ?: System.getenv("LUMINARA_VERSION_NAME"))
    ?.trim()
    ?.takeIf { it.isNotEmpty() }

val keystorePropsFile =
  rootProject.file("keystore.properties").takeIf { it.exists() }
    ?: file("keystore.properties").takeIf { it.exists() }
val keystoreProperties =
  Properties().apply {
    if (keystorePropsFile != null) {
      load(keystorePropsFile.inputStream())
    }
  }

val keystorePath =
  keystoreProperties.getProperty("storeFile")
    ?: System.getenv("LUMINARA_KEYSTORE_PATH")
    ?: "release.jks"
val releaseKeystore: File =
  rootProject.file(keystorePath).takeIf { it.exists() }
    ?: file(keystorePath)

android {
  namespace = "com.luminarasuite.app"
  compileSdk = 37

  defaultConfig {
    applicationId = "com.luminarasuite.app"
    minSdk = 26
    targetSdk = 36

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

    versionCode = versionCodeOverride ?: defaultVersionCode
    versionName = versionNameOverride ?: defaultVersionName
  }

  signingConfigs {
    create("release") {
      storeFile = releaseKeystore
      storePassword =
        keystoreProperties.getProperty("storePassword")
          ?: System.getenv("LUMINARA_KEYSTORE_PASSWORD")
          ?: ""
      keyAlias =
        keystoreProperties.getProperty("keyAlias")
          ?: System.getenv("LUMINARA_KEY_ALIAS")
          ?: ""
      keyPassword =
        keystoreProperties.getProperty("keyPassword")
          ?: System.getenv("LUMINARA_KEY_PASSWORD")
          ?: ""
    }
  }

  buildTypes {
    debug {
      buildConfigField("String", "API_BASE_URL", "\"https://www.luminarasuite.com/\"")
      buildConfigField("String", "WEB_BASE_URL", "\"https://www.luminarasuite.com\"")
    }
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      if (releaseKeystore.exists()) {
        signingConfig = signingConfigs.getByName("release")
      }
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      buildConfigField("String", "API_BASE_URL", "\"https://www.luminarasuite.com/\"")
      buildConfigField("String", "WEB_BASE_URL", "\"https://www.luminarasuite.com\"")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    compose = true
    aidl = false
    buildConfig = true
    shaders = false
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

kotlin {
  jvmToolchain(17)
}

detekt {
  buildUponDefaultConfig = true
  config.setFrom(rootProject.file("config/detekt/detekt.yml"))
  source.setFrom(files("src/main/kotlin", "src/test/kotlin", "src/androidTest/kotlin"))
}

tasks.withType<dev.detekt.gradle.Detekt>().configureEach {
  jvmTarget = JavaVersion.VERSION_17.toString()
  reports {
    html.required.set(true)
    sarif.required.set(false)
  }
}

room3 {
  schemaDirectory("$projectDir/schemas")
}

android.sourceSets["androidTest"].assets.directories.add("$projectDir/schemas")

val allowUnsignedRelease: Boolean =
  providers.gradleProperty("luminara.allowUnsignedRelease").orNull == "true"

tasks.matching { it.name == "packageRelease" || it.name == "packageReleaseBundle" }
  .configureEach {
    doFirst {
      if (!releaseKeystore.exists() && !allowUnsignedRelease) {
        throw GradleException(
          """
          Refusing to package an unsigned release.
          No keystore found at: ${releaseKeystore.absolutePath}
          Run .\apps\android\scripts\generate-release-keystore.ps1 locally or provide LUMINARA_KEYSTORE_BASE64 in CI.
          """.trimIndent(),
        )
      }
    }
  }

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation(libs.androidx.compose.material.icons.extended)
  debugImplementation(libs.androidx.compose.ui.tooling)

  implementation(libs.room3.runtime)
  ksp(libs.room3.compiler)

  implementation(libs.retrofit)
  implementation(libs.retrofit.converter.kotlinx.serialization)
  implementation(libs.okhttp)
  implementation(libs.kotlinx.serialization.json)

  implementation(libs.androidx.datastore.preferences)
  implementation(libs.androidx.browser)

  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)

  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)
  androidTestImplementation(libs.room3.testing)
  androidTestImplementation(libs.androidx.test.core)
  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.androidx.test.espresso.core)
}
