package com.luminarasuite.app.core.auth

/**
 * One plain-English read of a finished crawl, then hosted AI needs a Firebase account.
 * Crawl checks stay open so a Play reviewer can keep using Instant Audit.
 * The read is local: production refuses hosted model calls with no identity.
 */
object GuestTrial {
    const val SIGN_IN_FOR_HOSTED =
        "Sign in to use hosted AI, or add your Groq API key in Settings."

    const val SIGN_IN_AFTER_TASTE =
        "That was the free taste. Sign in to keep using hosted AI. Manage your plan on luminarasuite.com."

    private const val CREW_BEFORE =
        "Free crawler check. One plain-English read is included. Sign in for the full audit."

    private const val CREW_AFTER =
        "Sign in for the full audit and hosted AI. Manage your plan on luminarasuite.com."

    fun hostedSignInMessage(
        trialUsed: Boolean,
        beforeTaste: String,
    ): String = if (trialUsed) SIGN_IN_AFTER_TASTE else beforeTaste

    fun crewNote(trialUsed: Boolean): String = if (trialUsed) CREW_AFTER else CREW_BEFORE
}
