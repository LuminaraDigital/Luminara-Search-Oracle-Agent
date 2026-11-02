package com.luminarasuite.app.core.auth

/**
 * One plain-English read of a finished crawl, then hosted AI needs a free account.
 * Crawl checks stay open so a Play reviewer can keep using Instant Audit.
 * The read is local: production refuses hosted model calls with no identity.
 */
object GuestTrial {
    const val SIGN_IN_FOR_HOSTED =
        "Sign in to keep going. A free account includes 3 audits and 10 questions a day."

    const val SIGN_IN_AFTER_TASTE =
        "That was the free read. Sign in and your audits stay with your account. " +
            "Free includes 3 audits and 10 questions a day."

    private const val CREW_BEFORE =
        "Free check of the public files. One plain-English read is included. Sign in for the full audit."

    private const val CREW_AFTER =
        "Sign in for hosted audits and questions. A free account includes 3 audits and 10 questions a day."

    fun hostedSignInMessage(
        trialUsed: Boolean,
        beforeTaste: String,
    ): String = if (trialUsed) SIGN_IN_AFTER_TASTE else beforeTaste

    fun crewNote(trialUsed: Boolean): String = if (trialUsed) CREW_AFTER else CREW_BEFORE

    /** Limit copy that should offer Sign in, never a key form. */
    fun isHostedSignInGate(message: String): Boolean {
        val text = message.trim()
        return text.startsWith("Sign in") || text.startsWith("That was the free read")
    }
}
