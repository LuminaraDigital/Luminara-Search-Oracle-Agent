package com.luminarasuite.app.core.auth

import com.google.firebase.appcheck.AppCheckProviderFactory
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/**
 * Local smoke only. Play Integrity does not attest a debug signing key.
 * Logcat prints a debug token. Register that token on the Android app in
 * Firebase Console before expecting sign-in while Authentication is enforced.
 */
internal fun appCheckProviderFactory(): AppCheckProviderFactory = DebugAppCheckProviderFactory.getInstance()
