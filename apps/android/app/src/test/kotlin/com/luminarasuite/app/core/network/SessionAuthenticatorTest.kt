package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.auth.FIREBASE_SDK_REFRESH
import com.luminarasuite.app.core.auth.InMemoryVaultStorage
import com.luminarasuite.app.core.auth.VaultSnapshot
import com.luminarasuite.app.core.model.ByokKeyBag
import kotlinx.coroutines.runBlocking
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionAuthenticatorTest {
    private val signedIn =
        VaultSnapshot(idToken = "old", refreshToken = "refresh", email = "a@b.co", accountId = "fb:1")

    private fun unauthorized(token: String): Response =
        Response.Builder()
            .request(
                Request.Builder().url("https://example.com/api/boot").header("Authorization", "Bearer $token").build(),
            )
            .protocol(Protocol.HTTP_1_1)
            .code(401)
            .message("Unauthorized")
            .build()

    @Test
    fun renewsTokenAndReplaysRequest() {
        val vault = InMemoryVaultStorage(signedIn)
        val authenticator = SessionAuthenticator(vault) { RefreshOutcome.Renewed("new", "refresh2") }

        val retried = authenticator.authenticate(null, unauthorized("old"))

        assertEquals("Bearer new", retried?.header("Authorization"))
        val saved = runBlocking { vault.getSnapshot() }
        assertEquals("new", saved.idToken)
        assertEquals("refresh2", saved.refreshToken)
        assertEquals("a@b.co", saved.email)
    }

    @Test
    fun usesTokenAnotherCallAlreadyRenewed() {
        var calls = 0
        val vault = InMemoryVaultStorage(signedIn.copy(idToken = "already-new"))
        val authenticator =
            SessionAuthenticator(vault) {
                calls += 1
                RefreshOutcome.Unavailable
            }

        val retried = authenticator.authenticate(null, unauthorized("old"))

        assertEquals("Bearer already-new", retried?.header("Authorization"))
        assertEquals(0, calls)
    }

    @Test
    fun rejectedRefreshEndsTheSession() {
        val vault = InMemoryVaultStorage(signedIn)
        val authenticator = SessionAuthenticator(vault) { RefreshOutcome.Rejected }

        assertNull(authenticator.authenticate(null, unauthorized("old")))
        assertEquals("", runBlocking { vault.getSnapshot() }.idToken)
    }

    @Test
    fun rejectedRefreshDropsByokAndNotifiesTheLocalWipe() {
        val vault = InMemoryVaultStorage(signedIn.copy(byokKeys = ByokKeyBag(groqKey = "gsk_a")))
        var wiped = false
        val authenticator =
            SessionAuthenticator(vault, onSessionCleared = { wiped = true }) { RefreshOutcome.Rejected }

        assertNull(authenticator.authenticate(null, unauthorized("old")))
        val snap = runBlocking { vault.getSnapshot() }
        assertEquals("", snap.idToken)
        assertEquals("", snap.byokKeys.groqKey)
        assertTrue(wiped)
    }

    @Test
    fun outageKeepsTheSession() {
        val vault = InMemoryVaultStorage(signedIn)
        val authenticator = SessionAuthenticator(vault) { RefreshOutcome.Unavailable }

        assertNull(authenticator.authenticate(null, unauthorized("old")))
        assertEquals("old", runBlocking { vault.getSnapshot() }.idToken)
    }

    @Test
    fun signOutDuringRefreshIsNotUndone() {
        val vault = InMemoryVaultStorage(signedIn)
        val authenticator =
            SessionAuthenticator(vault) {
                runBlocking { vault.saveSession("other", "other-refresh", "c@d.co", "fb:2") }
                RefreshOutcome.Renewed("new", "refresh2")
            }

        assertNull(authenticator.authenticate(null, unauthorized("old")))
        assertEquals("other", runBlocking { vault.getSnapshot() }.idToken)
    }

    @Test
    fun guestRequestIsNeverRetried() {
        val vault = InMemoryVaultStorage()
        val authenticator = SessionAuthenticator(vault) { RefreshOutcome.Renewed("new", "r") }
        val guest =
            unauthorized("x").newBuilder()
                .request(Request.Builder().url("https://example.com/api/boot").build())
                .build()

        assertNull(authenticator.authenticate(null, guest))
    }

    @Test
    fun googleRefreshUsesTheSdkAndEmailRefreshUsesHttp() {
        var sdkCalls = 0
        var httpCalls = 0
        val sdkOutcome =
            chooseSessionRefresh(
                FIREBASE_SDK_REFRESH,
                sdk = {
                    sdkCalls += 1
                    RefreshOutcome.Renewed("a", FIREBASE_SDK_REFRESH)
                },
                http = {
                    httpCalls += 1
                    RefreshOutcome.Rejected
                },
            )
        assertTrue(sdkOutcome is RefreshOutcome.Renewed)
        assertEquals(1, sdkCalls)
        assertEquals(0, httpCalls)

        chooseSessionRefresh(
            "worker-refresh",
            sdk = {
                sdkCalls += 1
                RefreshOutcome.Unavailable
            },
            http = {
                httpCalls += 1
                RefreshOutcome.Rejected
            },
        )
        assertEquals(1, sdkCalls)
        assertEquals(1, httpCalls)
    }
}
