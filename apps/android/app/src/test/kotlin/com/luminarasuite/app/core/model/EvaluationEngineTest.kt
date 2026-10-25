package com.luminarasuite.app.core.model

import com.luminarasuite.app.core.database.toEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EvaluationEngineTest {
    @Test
    fun normalizeDomain_acceptsValidHostsAndStripsProtocolAndWww() {
        assertEquals("luminarasuite.com", EvaluationEngine.normalizeDomain("https://www.luminarasuite.com/audit"))
        assertEquals("sub.example.co.uk", EvaluationEngine.normalizeDomain("HTTP://sub.example.co.uk:8080/test"))
        assertEquals("developer.android.com", EvaluationEngine.normalizeDomain("  developer.android.com "))
    }

    @Test
    fun normalizeDomain_rejectsInvalidOrMalformedInputs() {
        assertNull(EvaluationEngine.normalizeDomain(""))
        assertNull(EvaluationEngine.normalizeDomain("   "))
        assertNull(EvaluationEngine.normalizeDomain("localhost"))
        assertNull(EvaluationEngine.normalizeDomain("not a domain"))
        assertNull(EvaluationEngine.normalizeDomain("-badhost.com"))
    }

    @Test
    fun evaluateCrawlerFiles_emitsNotMeasuredWhenAllHttpStatusesAreZero() {
        val result =
            EvaluationEngine.evaluateCrawlerFiles(
                domain = "example.com",
                snapshot = CrawlerFilesSnapshot(llmsHttpStatus = 0, robotsHttpStatus = 0, aiHttpStatus = 0),
            )
        assertEquals("not_measured", result.measurementStatus)
        assertEquals(0, result.passCount)
        assertEquals(0, result.failCount)
        assertTrue(result.checks.all { it.status == "not_measured" })
        assertTrue(result.botMatrix.all { it.status == "not_measured" })
    }

    @Test
    fun evaluateCrawlerFiles_passesAllChecksWhenLlmsRobotsAndAiTxtAreHealthy() {
        val snapshot =
            CrawlerFilesSnapshot(
                llmsTxt =
                """
                    # Luminara Suite
                    > AI search visibility and AEO audit platform.
                    ## Documentation
                    - [Instant Audit](https://luminarasuite.com/audit)
                """.trimIndent(),
                llmsHttpStatus = 200,
                robotsTxt =
                """
                    User-agent: *
                    Allow: /
                """.trimIndent(),
                robotsHttpStatus = 200,
                aiTxt = "User-agent: *\nAllow: /",
                aiHttpStatus = 200,
            )

        val result = EvaluationEngine.evaluateCrawlerFiles("luminarasuite.com", snapshot)
        assertEquals("measured", result.measurementStatus)
        assertEquals(5, result.passCount)
        assertEquals(0, result.failCount)
        assertTrue(result.botMatrix.all { it.status == "allowed" })
    }

    @Test
    fun evaluateCrawlerFiles_detectsBlockedAiBotsAndMissingLlmsTxt() {
        val snapshot =
            CrawlerFilesSnapshot(
                llmsTxt = "",
                llmsHttpStatus = 404,
                robotsTxt =
                """
                    User-agent: GPTBot
                    Disallow: /
                    User-agent: ClaudeBot
                    Disallow: /
                    User-agent: *
                    Allow: /
                """.trimIndent(),
                robotsHttpStatus = 200,
                aiTxt = "",
                aiHttpStatus = 404,
            )

        val result = EvaluationEngine.evaluateCrawlerFiles("example.com", snapshot)
        assertEquals("measured", result.measurementStatus)
        val botMap = result.botMatrix.associate { it.bot to it.status }
        assertEquals("blocked", botMap["GPTBot"])
        assertEquals("blocked", botMap["ClaudeBot"])
        assertEquals("allowed", botMap["PerplexityBot"])

        val checkMap = result.checks.associate { it.id to it.status }
        assertEquals("fail", checkMap["llms_txt"])
        assertEquals("fail", checkMap["ai_bot_directives"])
    }

    @Test
    fun entityMapping_preservesNullUnmeasuredMetrics() {
        val entry =
            AuditHistoryEntry(
                id = "audit-1",
                domain = "example.com",
                measuredAt = 1730000000000L,
                healthScore = null,
                citationRatePercent = null,
                schemaGapCount = 2,
                topCompetitor = null,
                title = "AEO audit · example.com",
                summary = "2 gaps detected",
            )
        val roundTrip = entry.toEntity().toDomain()
        assertNull(roundTrip.healthScore)
        assertNull(roundTrip.citationRatePercent)
        assertNull(roundTrip.topCompetitor)
        assertEquals(2, roundTrip.schemaGapCount)
    }
}
