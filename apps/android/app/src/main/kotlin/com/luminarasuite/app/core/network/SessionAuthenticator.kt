package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.auth.FIREBASE_SDK_REFRESH
import com.luminarasuite.app.core.auth.VaultStorage
import com.luminarasuite.app.core.model.AuthRefreshRequest
import com.luminarasuite.app.core.model.AuthRefreshResponse
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import java.io.IOException
import java.util.concurrent.TimeUnit

sealed interface RefreshOutcome {
    data class Renewed(
        val idToken: String,
        val refreshToken: String,
    ) : RefreshOutcome

    /** The refresh token itself was refused, so only a new sign-in can recover the session. */
    data object Rejected : RefreshOutcome

    /** Network or server trouble. Keep the session and let the caller see the 401. */
    data object Unavailable : RefreshOutcome
}

/**
 * Firebase ID tokens last an hour. On a 401 this renews the token once and replays the request,
 * so a signed-in session survives without the user noticing.
 */
class SessionAuthenticator(
    private val vault: VaultStorage,
    private val onSessionCleared: () -> Unit = {},
    private val refresh: (String) -> RefreshOutcome,
) : Authenticator {
    private val lock = Any()

    override fun authenticate(
        route: Route?,
        response: Response,
    ): Request? {
        if (response.priorResponse != null) return null
        val sentToken =
            response.request.header("Authorization")?.removePrefix("Bearer ")
                ?: return null
        return synchronized(lock) {
            val snapshot = runBlocking { vault.getSnapshot() }
            val freshToken =
                when {
                    snapshot.idToken.isBlank() -> null
                    // Another call already renewed the token while this one waited for the lock.
                    snapshot.idToken != sentToken -> snapshot.idToken
                    snapshot.refreshToken.isBlank() -> null
                    else -> renew(snapshot.refreshToken, snapshot.email, snapshot.accountId)
                }
            freshToken?.let { response.request.newBuilder().header("Authorization", "Bearer $it").build() }
        }
    }

    private fun renew(
        refreshToken: String,
        email: String,
        accountId: String,
    ): String? {
        val outcome = refresh(refreshToken)
        // The person may have signed out or switched accounts during the call.
        val sameSession = runBlocking { vault.getSnapshot() }.refreshToken == refreshToken
        return when {
            !sameSession -> null
            outcome is RefreshOutcome.Renewed -> {
                runBlocking { vault.saveSession(outcome.idToken, outcome.refreshToken, email, accountId) }
                outcome.idToken
            }
            outcome is RefreshOutcome.Rejected -> {
                runBlocking { vault.clearSession() }
                onSessionCleared()
                null
            }
            else -> null
        }
    }
}

/** Uses its own client so a refresh can never re-enter the authenticator. */
fun refreshOverHttp(
    apiBaseUrl: String,
    json: Json,
): (String) -> RefreshOutcome {
    val client = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build()
    val jsonType = "application/json".toMediaType()
    return { refreshToken ->
        val request =
            Request.Builder()
                .url("${apiBaseUrl}api/auth/refresh")
                .post(json.encodeToString(AuthRefreshRequest(refreshToken)).toRequestBody(jsonType))
                .build()
        try {
            client.newCall(request).execute().use { res ->
                val body = res.body.string()
                when {
                    res.code == 400 || res.code == 401 -> RefreshOutcome.Rejected
                    !res.isSuccessful -> RefreshOutcome.Unavailable
                    else -> {
                        val parsed = json.decodeFromString<AuthRefreshResponse>(body)
                        if (parsed.idToken.isBlank()) {
                            RefreshOutcome.Unavailable
                        } else {
                            RefreshOutcome.Renewed(parsed.idToken, parsed.refreshToken.ifBlank { refreshToken })
                        }
                    }
                }
            }
        } catch (_: IOException) {
            RefreshOutcome.Unavailable
        } catch (_: SerializationException) {
            // A captive portal can answer 200 with HTML. An uncaught error here would kill the app.
            RefreshOutcome.Unavailable
        }
    }
}

/** Email sessions renew through the Worker. Google sessions renew inside Firebase Auth. */
fun chooseSessionRefresh(
    refreshToken: String,
    sdk: () -> RefreshOutcome,
    http: (String) -> RefreshOutcome,
): RefreshOutcome = if (refreshToken == FIREBASE_SDK_REFRESH) sdk() else http(refreshToken)
