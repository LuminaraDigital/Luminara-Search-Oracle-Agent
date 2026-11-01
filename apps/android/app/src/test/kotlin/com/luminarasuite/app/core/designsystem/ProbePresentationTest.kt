package com.luminarasuite.app.core.designsystem

import com.luminarasuite.app.core.model.BotDirectiveStatus
import com.luminarasuite.app.core.model.ReadinessCheck
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProbePresentationTest {
    @Test
    fun probeBeacons_stayWaitingUntilARealCrawlColoursThem() {
        val idle = probeBeacons(isLoading = false, checks = null)
        assertEquals(listOf("/robots.txt", "/llms.txt", "/ai.txt"), idle.map { it.path })
        assertTrue(idle.all { it.tone == ProbeTone.Idle })
        assertEquals(
            "Nothing measured yet. Probe a host to light these files.",
            probeCaption(isLoading = false, beacons = idle),
        )

        val running = probeBeacons(isLoading = true, checks = passingChecks())
        assertTrue(running.all { it.tone == ProbeTone.Running })
        assertTrue(probeCaption(isLoading = true, beacons = running).contains("Nothing is scored"))
    }

    @Test
    fun probeBeacons_failAFileWhenAnyRelatedCheckFails() {
        val checks =
            listOf(
                ReadinessCheck("ai_bot_directives", "robots", "pass", ""),
                ReadinessCheck("llms_txt", "llms", "pass", ""),
                ReadinessCheck("llms_structure", "structure", "fail", ""),
                ReadinessCheck("cite_paths", "cite", "pass", ""),
                ReadinessCheck("ai_txt", "ai", "not_measured", ""),
            )
        val beacons = probeBeacons(isLoading = false, checks = checks)
        assertEquals(ProbeTone.Pass, beacons.first { it.path == "/robots.txt" }.tone)
        assertEquals(ProbeTone.Fail, beacons.first { it.path == "/llms.txt" }.tone)
        assertEquals(ProbeTone.Unknown, beacons.first { it.path == "/ai.txt" }.tone)
        assertEquals(
            "1 of 3 files passed. 1 failed. 1 not measured.",
            probeCaption(isLoading = false, beacons = beacons),
        )
        assertFalse(auditIsClear("measured", checks, failCount = 1))
    }

    @Test
    fun auditIsClear_requiresEveryCheckToPass() {
        val clear = passingChecks()
        assertTrue(auditIsClear("measured", clear, failCount = 0))
        assertFalse(auditIsClear("not_measured", clear, failCount = 0))
        assertFalse(auditIsClear("measured", emptyList(), failCount = 0))
    }

    @Test
    fun botAllowanceLabel_doesNotTreatAnUnmeasuredMatrixAsZeroAllowed() {
        val unmeasured = List(10) { BotDirectiveStatus("Bot$it", "not_measured") }
        assertEquals("NOT_MEASURED", botAllowanceLabel(unmeasured))
        assertEquals("NOT_MEASURED", botAllowanceLabel(emptyList()))

        val mixed =
            listOf(
                BotDirectiveStatus("GPTBot", "allowed"),
                BotDirectiveStatus("ClaudeBot", "blocked"),
                BotDirectiveStatus("CCBot", "not_specified"),
            )
        assertEquals("1 of 3 allowed", botAllowanceLabel(mixed))
    }

    private fun passingChecks(): List<ReadinessCheck> =
        listOf(
            ReadinessCheck("ai_bot_directives", "robots", "pass", ""),
            ReadinessCheck("llms_txt", "llms", "pass", ""),
            ReadinessCheck("llms_structure", "structure", "pass", ""),
            ReadinessCheck("cite_paths", "cite", "pass", ""),
            ReadinessCheck("ai_txt", "ai", "pass", ""),
        )
}
