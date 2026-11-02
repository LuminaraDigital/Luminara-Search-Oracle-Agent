package com.luminarasuite.app.core.auth

import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.GoogleAuthProvider
import com.luminarasuite.app.core.model.AuthTokenResponse
import com.luminarasuite.app.core.network.RefreshOutcome
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Google sign-in stores the refresh token inside Firebase Auth, not in the vault. */
const val FIREBASE_SDK_REFRESH = "firebase-sdk"

/**
 * The device Firebase Auth session. Email still goes through the Worker first
 * (same rate limit as the website); this hydrates the SDK and mints the ID token
 * the Worker already verifies. Tests use [PassthroughFirebaseAccount].
 */
interface FirebaseAccount {
    suspend fun adoptPassword(
        email: String,
        password: String,
        issued: AuthTokenResponse,
    ): AuthTokenResponse

    suspend fun signInWithGoogle(googleIdToken: String): AuthTokenResponse

    suspend fun forceRefresh(): RefreshOutcome

    fun signOut()
}

object PassthroughFirebaseAccount : FirebaseAccount {
    override suspend fun adoptPassword(
        email: String,
        password: String,
        issued: AuthTokenResponse,
    ): AuthTokenResponse = issued

    override suspend fun signInWithGoogle(googleIdToken: String): AuthTokenResponse =
        throw IllegalStateException("Google sign-in is unavailable on this device.")

    override suspend fun forceRefresh(): RefreshOutcome = RefreshOutcome.Unavailable

    override fun signOut() = Unit
}

class AndroidFirebaseAccount(
    private val auth: FirebaseAuth,
) : FirebaseAccount {
    override suspend fun adoptPassword(
        email: String,
        password: String,
        issued: AuthTokenResponse,
    ): AuthTokenResponse =
        try {
            hydrate(email, password, issued)
        } catch (err: CancellationException) {
            throw err
        } catch (_: FirebaseException) {
            // The Worker already returned a Firebase ID token. The SDK can catch up on the next launch.
            issued
        }

    override suspend fun signInWithGoogle(googleIdToken: String): AuthTokenResponse =
        try {
            googleSession(googleIdToken)
        } catch (err: CancellationException) {
            throw err
        } catch (err: FirebaseException) {
            throw googleFailure(err)
        }

    override suspend fun forceRefresh(): RefreshOutcome {
        val user = auth.currentUser ?: return RefreshOutcome.Rejected
        return try {
            val token = user.getIdToken(true).awaitResult().token
            if (token.isNullOrBlank()) {
                RefreshOutcome.Unavailable
            } else {
                RefreshOutcome.Renewed(token, FIREBASE_SDK_REFRESH)
            }
        } catch (err: CancellationException) {
            throw err
        } catch (err: FirebaseException) {
            if (deadSession(err)) RefreshOutcome.Rejected else RefreshOutcome.Unavailable
        }
    }

    private suspend fun googleSession(googleIdToken: String): AuthTokenResponse {
        val credential = GoogleAuthProvider.getCredential(googleIdToken, null)
        val user = auth.signInWithCredential(credential).awaitResult().user
        check(user != null) { "Google sign-in failed. Try again." }
        val token = user.getIdToken(false).awaitResult().token?.takeIf { it.isNotBlank() }
        check(token != null) { "Google sign-in failed. Try again." }
        val email =
            user.email?.trim().orEmpty().ifBlank {
                user.providerData.firstNotNullOfOrNull { row ->
                    row.email?.trim()?.takeIf { it.isNotBlank() }
                }.orEmpty()
            }
        check(email.isNotBlank()) {
            "Google did not share an email address. Choose an account that includes one."
        }
        return AuthTokenResponse(
            ok = true,
            idToken = token,
            refreshToken = FIREBASE_SDK_REFRESH,
            localId = user.uid,
            email = email,
        )
    }

    override fun signOut() {
        auth.signOut()
    }

    private suspend fun hydrate(
        email: String,
        password: String,
        issued: AuthTokenResponse,
    ): AuthTokenResponse {
        val user =
            auth.signInWithEmailAndPassword(email, password).awaitResult().user
                ?: return issued
        val token = user.getIdToken(false).awaitResult().token?.takeIf { it.isNotBlank() } ?: return issued
        return issued.copy(
            idToken = token,
            localId = user.uid.ifBlank { issued.localId },
            email = user.email?.takeIf { it.isNotBlank() } ?: issued.email,
        )
    }
}

private fun deadSession(err: FirebaseException): Boolean {
    val code = (err as? FirebaseAuthException)?.errorCode.orEmpty()
    return code == "ERROR_USER_DISABLED" || code == "ERROR_USER_TOKEN_EXPIRED" || code == "ERROR_INVALID_USER_TOKEN"
}

private fun googleFailure(err: Exception): IllegalStateException {
    val code = (err as? FirebaseAuthException)?.errorCode.orEmpty()
    val message =
        when (code) {
            "ERROR_ACCOUNT_EXISTS_WITH_DIFFERENT_CREDENTIAL" ->
                "That email already uses a password. Sign in with email, or reset it on luminarasuite.com."
            "ERROR_USER_DISABLED" -> "This account is disabled."
            "ERROR_NETWORK_REQUEST_FAILED" -> "Google sign-in needs a network connection."
            else -> "Google sign-in failed. Try again."
        }
    return IllegalStateException(message)
}

private suspend fun <T> Task<T>.awaitResult(): T =
    suspendCancellableCoroutine { cont ->
        addOnCompleteListener { task ->
            if (!cont.isActive) return@addOnCompleteListener
            val error = task.exception
            if (error != null) {
                cont.resumeWithException(error)
            } else {
                val value = task.result
                if (value == null) {
                    cont.resumeWithException(IllegalStateException("Firebase returned an empty result."))
                } else {
                    cont.resume(value)
                }
            }
        }
    }
