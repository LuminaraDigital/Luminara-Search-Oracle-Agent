package com.luminarasuite.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CrewRulesTest {
    private val goodPage =
        CrewPage(
            url = "https://example.com",
            title = "Example Co - Plumbing",
            schemas = listOf(CrewSchema("Organization", "Example Co")),
            wordCount = 900,
            textSnippet = "We fix pipes.",
        )

    private fun row(
        mentioned: Boolean,
        title: String = "A result",
    ) = SearchRow("what is example.com", title, "https://other.test/a", "text", mentioned)

    @Test
    fun scoresOnlyWhenPageAndSearchAreBothLive() {
        val measured = CrewRules.assess("example.com", listOf(goodPage), listOf(row(true), row(false)), emptyList())
        assertEquals(85, measured.healthScore)
        assertEquals(50, measured.citationRatePercent)
        assertEquals(1, measured.shareOfVoice)
        assertEquals("measured", measured.measurementStatus)

        val noSearch = CrewRules.assess("example.com", listOf(goodPage), emptyList(), emptyList())
        assertNull(noSearch.healthScore)
        assertNull(noSearch.citationRatePercent)
        assertEquals("not_measured", noSearch.measurementStatus)

        val noPage = CrewRules.assess("example.com", emptyList(), listOf(row(true)), emptyList())
        assertNull(noPage.healthScore)
        assertEquals(100, noPage.citationRatePercent)
        assertEquals("not_measured", noPage.measurementStatus)
        assertTrue(noPage.fixes.isEmpty())
    }

    @Test
    fun blockedPagesAndSampleRowsDoNotCount() {
        val blocked = goodPage.copy(httpStatus = 403)
        val challenge = goodPage.copy(title = "Just a moment...")
        assertNull(CrewRules.assess("example.com", listOf(blocked), listOf(row(true)), emptyList()).healthScore)
        assertNull(CrewRules.assess("example.com", listOf(challenge), listOf(row(true)), emptyList()).healthScore)

        val sample = CrewRules.assess("example.com", listOf(goodPage), listOf(row(true, "SAMPLE result")), emptyList())
        assertNull(sample.citationRatePercent)
        assertTrue(sample.searchRows.isEmpty())
    }

    @Test
    fun penaltiesMatchTheWebChecklist() {
        val weak = CrewPage(url = "https://example.com", title = "Home", wordCount = 100, textSnippet = "Hi")
        val howTo = weak.copy(url = "https://example.com/a", schemas = listOf(CrewSchema("HowTo", null)))
        val result = CrewRules.assess("example.com", listOf(weak, howTo), listOf(row(false)), emptyList())
        assertEquals(45, result.healthScore)
        assertEquals(HealthChecklist(0, 4, 4), result.checklist)
        assertEquals(
            setOf(
                "finding-zero-citations",
                "finding-schema-org",
                "finding-deprecated-howto",
                "finding-thin-content",
            ),
            result.findings.map { it.id }.toSet(),
        )
    }

    @Test
    fun partialIdentityTagIsListedWithoutAPenalty() {
        val bare = goodPage.copy(url = "https://example.com/about", schemas = emptyList())
        val result = CrewRules.assess("example.com", listOf(goodPage, bare), listOf(row(true)), emptyList())
        assertEquals(85, result.healthScore)
        assertEquals(listOf("finding-schema-org-partial"), result.findings.map { it.id })
        assertEquals(listOf("patch-schema-org"), result.fixes.map { it.id })
    }

    @Test
    fun failedCrawlerChecksGetAStepAndADraft() {
        val checks = listOf(ReadinessCheck("llms_txt", "llms.txt", "fail", "HTTP 404"))
        val result = CrewRules.assess("example.com", listOf(goodPage), listOf(row(true)), checks)
        assertTrue(result.brief.steps.single().startsWith("Add a short page at /llms.txt"))
        assertTrue(result.fixes.single().snippet.startsWith("# Example Co"))
    }

    @Test
    fun namesakesAreNotMentions() {
        val check = { url: String, title: String, text: String ->
            EntityMatch.mentionsAudited("luminarasuite.com", "Luminara Suite", url, title, text)
        }
        assertTrue(check("https://www.luminarasuite.com/x", "Anything", ""))
        assertTrue(check("https://blog.test/a", "Review", "Read about luminarasuite.com today."))
        assertTrue(check("https://blog.test/a", "Luminara Suite review", ""))
        assertFalse(check("https://luminarasuite.org/a", "Luminara Suite", ""))
        assertFalse(check("https://blog.test/a", "Luminara candles", "A lovely gift"))
        assertFalse(check("https://blog.test/a", "x", "See luminarasuite.com.evil.test"))
    }

    @Test
    fun pageSchemasReadGraphsArraysAndSkipBrokenBlocks() {
        val html =
            """
            <script type="application/ld+json">{"@graph":[{"@type":["Organization","Thing"],"name":"Acme"}]}</script>
            <script type='application/ld+json'>[{"@type":"FAQPage"}]</script>
            <script type="application/ld+json">{not json at all</script>
            """.trimIndent()
        val schemas = PageSchemas.extract(html)
        assertEquals(listOf("Organization", "Thing", "FAQPage"), schemas.map { it.type })
        assertEquals("Acme", schemas.first().name)
    }

    @Test
    fun brandPrefersThePageAndRejectsGenericTitles() {
        assertEquals("Acme", BrandName.fromPage(goodPage.copy(siteName = "Acme", title = "x")))
        assertEquals("Example Co", BrandName.fromPage(goodPage))
        assertNull(BrandName.fromPage(CrewPage(url = "u", title = "Home | Acme")))
        assertEquals("Ray White", BrandName.readableStem("www.ray-white.com.au"))
    }

    @Test
    fun nextFixPicksTheMostSevereOpenWork() {
        val finding = { id: String, severity: String, status: String ->
            AuditFinding(
                id = id,
                domain = "example.com",
                severity = severity,
                title = id,
                description = "",
                status = status,
                createdAt = 0,
                updatedAt = 0,
            )
        }
        val picked =
            CrewRules.pickNextFix(
                listOf(
                    finding("done", "critical", "resolved"),
                    finding("x-unmeasured", "critical", "open"),
                    finding("medium", "medium", "open"),
                    finding("high", "high", "in_progress"),
                ),
            )
        assertNotNull(picked)
        assertEquals("high", picked?.id)
    }

    @Test
    fun stableKeyMatchesTheWebImplementation() {
        // Expected value produced by services/audit/findingStableKey.ts.
        assertEquals(
            "fk_ab4bed5d_4c148f2d",
            CrewRules.stableKey("https://www.example.com/", "schema", "Add a Tag!"),
        )
    }
}
