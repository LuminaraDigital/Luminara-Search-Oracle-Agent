package com.luminarasuite.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HostedPlanTest {
    @Test
    fun hostedPlanCopy_mapsGuestFreePaidAndCanceledWithoutACheckoutLink() {
        val guest = hostedPlanCopy(signedIn = false, quota = null)
        assertEquals("Guest", guest.title)
        assertEquals("Already on a paid plan? Your plan syncs when you sign in.", guest.manage)
        assertTrue(guest.detail.contains("plain-English"))
        assertTrue(guest.detail.contains("Sign in"))
        assertFalse(guest.detail.contains("API key"))
        assertFalse(guest.manage.orEmpty().contains("http"))
        assertFalse(guest.manage.orEmpty().contains("/"))

        val free =
            hostedPlanCopy(
                signedIn = true,
                quota =
                QuotaStatus(
                    ok = true,
                    authenticated = true,
                    plan = "free",
                    limit = 3,
                    remaining = 2,
                    entitlement = HostedEntitlement(tier = "free", name = "Free", status = "none"),
                ),
            )
        assertEquals("Free", free.title)
        assertEquals("2 of 3 audits left today. Resets at midnight UTC.", free.detail)
        assertEquals("Already on a paid plan? Your plan syncs when you sign in.", free.manage)

        val growth =
            hostedPlanCopy(
                signedIn = true,
                quota =
                QuotaStatus(
                    ok = true,
                    plan = "growth",
                    limit = -1,
                    remaining = -1,
                    isUnlimited = true,
                    entitlement = HostedEntitlement(tier = "growth", name = "Growth", status = "active"),
                ),
            )
        assertEquals("Growth", growth.title)
        assertEquals("No daily cap on this plan.", growth.detail)

        val copy = listOf(guest.detail, free.detail, growth.detail, free.manage)
        assertFalse(copy.joinToString(" ").contains("\u2014"))
        assertFalse(copy.joinToString(" ").contains("\u2013"))
        assertEquals("Already on a paid plan? Your plan syncs when you sign in.", free.manage)
        assertFalse(free.manage.orEmpty().contains("http"))
        assertFalse(free.manage.orEmpty().contains("/"))
    }

    @Test
    fun hostedPlanCopy_canceledTermKeepsTheFreeMeterAndDoesNotInventACap() {
        val canceled =
            hostedPlanCopy(
                signedIn = true,
                quota =
                QuotaStatus(
                    ok = true,
                    plan = "free",
                    limit = 3,
                    remaining = 1,
                    entitlement = HostedEntitlement(tier = "free", name = "Free", status = "canceled"),
                ),
            )
        assertEquals("Free", canceled.title)
        assertEquals(
            "Card plan canceled. 1 of 3 audits left today. Resets at midnight UTC.",
            canceled.detail,
        )

        val unloaded = hostedPlanCopy(signedIn = true, quota = null)
        assertEquals("Account", unloaded.title)
        assertEquals("Plan not loaded.", unloaded.detail)
        assertFalse(unloaded.detail.contains("3 daily"))
    }

    @Test
    fun hostedAllowanceOpen_followsUnlimitedRemainingAndReferralCredits() {
        assertFalse(hostedAllowanceOpen(null))
        assertFalse(hostedAllowanceOpen(QuotaStatus(remaining = 0, limit = 3, bonusRemaining = 0)))
        assertTrue(hostedAllowanceOpen(QuotaStatus(remaining = 1, limit = 3)))
        assertTrue(hostedAllowanceOpen(QuotaStatus(remaining = 0, bonusRemaining = 2)))
        assertTrue(hostedAllowanceOpen(QuotaStatus(isUnlimited = true, remaining = -1, limit = -1)))
    }

    @Test
    fun askAllowance_isSeparateFromAuditsAndStaysQuietUntilTheCapIsClose() {
        val openAsk = QuotaStatus(remaining = 0, limit = 3, askLimit = 10, askRemaining = 8, resetSec = 3600)
        assertFalse(hostedAllowanceOpen(openAsk))
        assertTrue(askAllowanceOpen(openAsk))
        assertEquals("0 of 3 audits left today. Resets in 1h 0m (midnight UTC).", auditUsageLine(openAsk))
        assertNull(askUsageLine(openAsk))

        val nearAsk = openAsk.copy(askRemaining = 2)
        assertEquals("2 of 10 questions left today. Resets in 1h 0m (midnight UTC).", askUsageLine(nearAsk))
        assertFalse(askAllowanceOpen(openAsk.copy(askRemaining = 0)))
        assertTrue(askBlockedMessage(openAsk.copy(askRemaining = 0)).contains("10 questions"))
        assertFalse(askBlockedMessage(openAsk).contains("API key"))
        assertFalse(auditBlockedMessage(openAsk).contains("API key"))
    }
}
