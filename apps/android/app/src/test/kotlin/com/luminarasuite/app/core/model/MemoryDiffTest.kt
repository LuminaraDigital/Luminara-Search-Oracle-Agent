package com.luminarasuite.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryDiffTest {
    private fun audit(
        at: Long,
        gaps: Int?,
    ) = AuditHistoryEntry(
        id = "a$at",
        domain = "example.com",
        focus = "AEO",
        measuredAt = at,
        healthScore = null,
        citationRatePercent = null,
        schemaGapCount = gaps,
        topCompetitor = null,
        title = "t",
        summary = "s",
        reportExcerpt = "r",
    )

    @Test
    fun comparesTheTwoNewestAudits() {
        val change = auditChanges(listOf(audit(1, 9), audit(3, 1), audit(2, 3))).single()

        assertEquals(true, change.improved)
        assertEquals("2 fewer open gaps", change.headline)
    }

    @Test
    fun singleAuditHasNothingToCompare() {
        assertTrue(auditChanges(listOf(audit(1, 2))).isEmpty())
    }

    @Test
    fun unmeasuredAuditIsNotAChange() {
        assertTrue(auditChanges(listOf(audit(1, 2), audit(2, null))).isEmpty())
    }

    @Test
    fun fixesShippedIsNullWithNothingToCount() {
        assertNull(fixesShipped(emptyList(), "example.com"))
    }
}
