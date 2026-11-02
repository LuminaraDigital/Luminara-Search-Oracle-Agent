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
            detail = "One site check and one plain-English read. Sign in for 3 audits and 10 questions a day.",
            manage = PLAN_SYNC,
        )
    }
    if (quota == null) {
        return HostedPlanCopy(
            title = "Account",
            detail = "Plan not loaded.",
            manage = PLAN_SYNC,
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
        manage = PLAN_SYNC,
    )
}

private const val PLAN_SYNC = "Already on a paid plan? Your plan syncs when you sign in."

/** True when a signed-in caller may spend a hosted audit. */
fun hostedAllowanceOpen(quota: QuotaStatus?): Boolean {
    if (quota == null) return false
    if (quota.isUnlimited) return true
    if (quota.remaining > 0) return true
    return quota.bonusRemaining > 0
}

/** True when a signed-in caller may spend a hosted question. A missing counter lets the server decide. */
fun askAllowanceOpen(quota: QuotaStatus?): Boolean {
    if (quota == null) return false
    if (quota.isUnlimited || quota.askLimit < 0) return true
    if (quota.askRemaining < 0) return true
    return quota.askRemaining > 0
}

fun auditBlockedMessage(quota: QuotaStatus?): String {
    if (quota == null) return "Could not read the hosted plan. Try again in a minute."
    val cap = quota.limit.takeIf { it > 0 } ?: 3
    return "That's your $cap free audits for today. They're saved in Memory. You'll get $cap more at midnight UTC."
}

fun askBlockedMessage(quota: QuotaStatus?): String {
    if (quota == null) return "Could not read the hosted plan. Try again in a minute."
    val cap = quota.askLimit.takeIf { it > 0 } ?: 10
    return "You've used today's $cap questions. Your audit and fix list are still here. " +
        "More questions tomorrow at midnight UTC."
}

fun resetPhrase(resetSec: Int): String {
    if (resetSec <= 0) return "Resets at midnight UTC."
    val hours = resetSec / 3600
    val minutes = (resetSec % 3600) / 60
    return if (hours > 0) "Resets in ${hours}h ${minutes}m (midnight UTC)." else "Resets in ${minutes}m (midnight UTC)."
}

/** Short audit chip. Null when the account has no daily audit cap. */
fun auditUsageLine(quota: QuotaStatus?): String? {
    if (quota == null || quota.isUnlimited || quota.limit <= 0) return null
    val left = quota.remaining.coerceAtLeast(0)
    return "$left of ${quota.limit} audits left today. ${resetPhrase(quota.resetSec)}"
}

/** Question chip only when 3 or fewer remain, so the counter stays quiet until it matters. */
fun askUsageLine(quota: QuotaStatus?): String? {
    if (quota == null || quota.isUnlimited) return null
    if (quota.askLimit <= 0 || quota.askRemaining < 0) return null
    if (quota.askRemaining > 3) return null
    return "${quota.askRemaining} of ${quota.askLimit} questions left today. ${resetPhrase(quota.resetSec)}"
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
    val asks =
        if (quota.askLimit > 0 && quota.askRemaining >= 0) {
            " ${quota.askRemaining} of ${quota.askLimit} questions left."
        } else {
            ""
        }
    return "$left of $cap audits left today.$asks ${resetPhrase(quota.resetSec)}"
}
