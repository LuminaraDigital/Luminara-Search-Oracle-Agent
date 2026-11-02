package com.luminarasuite.app.core.network

/**
 * Header the Worker and Identity Toolkit already accept. Not a new flag.
 */
internal const val FIREBASE_APP_CHECK_HEADER = "X-Firebase-AppCheck"

/**
 * App Check tokens are JWTs. A non-JWT placeholder means attestation failed.
 */
internal fun appCheckHeaderValue(token: String?): String? {
    val trimmed = token?.trim().orEmpty()
    if (trimmed.count { it == '.' } != 2) return null
    return trimmed
}

/**
 * shortcut: a failed attestation is skipped for one minute so an unregistered
 * Play Integrity provider does not stall every Worker call, drop the skip once
 * Console registration is live and tokens succeed.
 */
internal class AppCheckTokens(
    private val read: () -> String?,
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val backoffMs: Long = 60_000,
) {
    private var skipUntilMs = 0L

    fun current(): String? =
        synchronized(this) {
            val now = nowMs()
            if (now < skipUntilMs) return null
            val token = appCheckHeaderValue(read())
            skipUntilMs = if (token == null) now + backoffMs else 0L
            token
        }
}
