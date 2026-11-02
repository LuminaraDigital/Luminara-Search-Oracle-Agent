package com.luminarasuite.app.core.auth

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

private const val APP_CHECK_TOKEN_WAIT_SECONDS = 2L

/**
 * Installs App Check before any Firebase Auth call. Release uses Play Integrity.
 * Debug uses the debug provider. Authentication enforcement rejects sign-in
 * when this has not run.
 */
fun installAppCheck(context: Context) {
    FirebaseApp.initializeApp(context)
    FirebaseAppCheck.getInstance().installAppCheckProviderFactory(appCheckProviderFactory())
}

/** Cached or freshly exchanged token. Null when attestation fails or times out. */
internal fun blockingAppCheckToken(): String? =
    try {
        Tasks.await(
            FirebaseAppCheck.getInstance().getAppCheckToken(false),
            APP_CHECK_TOKEN_WAIT_SECONDS,
            TimeUnit.SECONDS,
        ).token
    } catch (err: InterruptedException) {
        Thread.currentThread().interrupt()
        null
    } catch (_: TimeoutException) {
        null
    } catch (_: ExecutionException) {
        null
    } catch (_: CancellationException) {
        null
    }
