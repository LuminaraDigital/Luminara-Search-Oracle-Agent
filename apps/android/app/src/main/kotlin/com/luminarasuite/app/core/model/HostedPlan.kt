package com.luminarasuite.app.core.model

data class HostedPlanCopy(
    val title: String,
    val detail: String,
    val manage: String?,
)

private val PAID_TIERS = setOf("starter", "growth", "agency")

/** Settings copy from the Worker entitlement. Measured numbers come only from the quota payload. */
fun hostedPlanCopy(
    signedIn: Boolean,
    quota: QuotaStatus?,
): HostedPlanCopy {
    if (!signedIn) {
        return HostedPlanCopy(
            title = "Guest",
            detail = "Free companion. Bring your own API keys. Sign in for cloud history sync.",
            manage = null,
        )
    }
    if (quota == null) {
        return HostedPlanCopy(
            title = "Account",
            detail = "Plan not loaded.",
            manage = "Manage plan on luminarasuite.com",
        )
    }
    val entitlement = quota.entitlement
    val tier = (entitlement?.tier ?: quota.plan).lowercase()
    val title = entitlement?.name?.takeIf { it.isNotBlank() } ?: titleFor(tier)
    val detail =
        when {
            entitlement?.status == "canceled" -> "Card plan canceled. ${allowanceLine(quota)}"
            quota.isUnlimited || tier in PAID_TIERS -> "No daily cap on this plan."
            else -> allowanceLine(quota)
        }
    return HostedPlanCopy(
        title = title,
        detail = detail,
        manage = "Manage plan on luminarasuite.com",
    )
}

/** True when a signed-in caller may use a hosted model key. BYOK skips this check. */
fun hostedAllowanceOpen(quota: QuotaStatus?): Boolean {
    if (quota == null) return false
    if (quota.isUnlimited) return true
    if (quota.remaining > 0) return true
    return quota.bonusRemaining > 0
}

fun hostedBlockedMessage(quota: QuotaStatus?): String =
    if (quota == null) {
        "Could not read the hosted plan. Try again, or add your Groq API key in Settings."
    } else {
        "Hosted checks are used up for today. Add your Groq API key in Settings."
    }

private fun titleFor(tier: String): String =
    when (tier) {
        "guest" -> "Guest"
        "starter" -> "Starter"
        "growth" -> "Growth"
        "agency" -> "Agency"
        else -> "Free"
    }

private fun allowanceLine(quota: QuotaStatus): String {
    if (quota.isUnlimited || quota.limit < 0) return "No daily cap on this plan."
    if (quota.remaining <= 0 && quota.bonusRemaining > 0) {
        return "Daily cap reached. ${quota.bonusRemaining} referral checks left today."
    }
    val left = quota.remaining.coerceAtLeast(0)
    val cap = quota.limit.coerceAtLeast(0)
    return "$left of $cap hosted checks left today."
}
