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
        assertNull(guest.manage)
        assertTrue(guest.detail.contains("Free companion"))

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
        assertEquals("2 of 3 hosted checks left today.", free.detail)
        assertEquals("Manage plan on luminarasuite.com", free.manage)

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
        assertEquals("Manage plan on luminarasuite.com", free.manage)
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
        assertEquals("Card plan canceled. 1 of 3 hosted checks left today.", canceled.detail)

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
}
