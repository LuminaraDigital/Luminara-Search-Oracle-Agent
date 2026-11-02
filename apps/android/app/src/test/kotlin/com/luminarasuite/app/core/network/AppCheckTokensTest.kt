package com.luminarasuite.app.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppCheckTokensTest {
    @Test
    fun dropsBlankAndNonJwtTokens() {
        assertNull(appCheckHeaderValue(null))
        assertNull(appCheckHeaderValue("  "))
        assertNull(appCheckHeaderValue("eyJlcnJvciI6IlVOS05PV05fRVJST1IifQ=="))
        assertEquals("a.b.c", appCheckHeaderValue(" a.b.c "))
    }

    @Test
    fun skipsAttestationAfterAFailure() {
        var calls = 0
        var now = 1_000L
        val tokens =
            AppCheckTokens(
                read = {
                    calls += 1
                    null
                },
                nowMs = { now },
                backoffMs = 60_000,
            )

        assertNull(tokens.current())
        assertEquals(1, calls)
        assertNull(tokens.current())
        assertEquals(1, calls)
        now += 60_000
        assertNull(tokens.current())
        assertEquals(2, calls)
    }

    @Test
    fun keepsReadingAfterSuccess() {
        var calls = 0
        val tokens =
            AppCheckTokens(
                read = {
                    calls += 1
                    "tok.en.jwt"
                },
                nowMs = { 0L },
            )

        assertEquals("tok.en.jwt", tokens.current())
        assertEquals("tok.en.jwt", tokens.current())
        assertEquals(2, calls)
    }

    @Test
    fun successClearsAPreviousSkip() {
        var token: String? = null
        var now = 0L
        val tokens = AppCheckTokens(read = { token }, nowMs = { now }, backoffMs = 60_000)

        assertNull(tokens.current())
        now += 60_000
        token = "  fresh.token.jwt  "
        assertEquals("fresh.token.jwt", tokens.current())
        token = null
        assertNull(tokens.current())
    }
}
