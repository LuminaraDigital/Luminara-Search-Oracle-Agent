package com.luminarasuite.app.core.model

import java.net.URI
import java.util.Locale

object EvaluationEngine {
    val CANONICAL_AI_BOTS: List<String> =
        listOf(
            "GPTBot",
            "OAI-SearchBot",
            "ChatGPT-User",
            "ClaudeBot",
            "Claude-SearchBot",
            "PerplexityBot",
            "Google-Extended",
            "Applebot-Extended",
            "CCBot",
            "Bytespider",
        )

    private val HOST_REGEX =
        Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")
    private val MARKDOWN_LINK_REGEX = Regex("\\[[^]]+]\\(https?://[^)]+\\)")

    fun normalizeDomain(rawInput: String): String? {
        val trimmed = rawInput.trim().lowercase(Locale.ROOT)
        if (trimmed.isEmpty() || trimmed.length > 253) return null
        val candidateUrl =
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "https://$trimmed"
            }
        val host =
            runCatching {
                URI(candidateUrl).host?.lowercase(Locale.ROOT)?.removePrefix("www.")
            }.getOrNull() ?: return null

        return if (HOST_REGEX.matches(host)) host else null
    }

    fun evaluateCrawlerFiles(
        domain: String,
        snapshot: CrawlerFilesSnapshot,
    ): CrawlerEvaluationResult {
        val anyMeasured =
            snapshot.llmsHttpStatus > 0 || snapshot.robotsHttpStatus > 0 || snapshot.aiHttpStatus > 0
        if (!anyMeasured) {
            return unmeasuredResult(domain)
        }

        val botMatrix =
            parseBotMatrix(
                robotsTxt = snapshot.robotsTxt,
                robotsMeasured = snapshot.robotsHttpStatus > 0,
                robotsPresent = isHttpSuccess(snapshot.robotsHttpStatus, snapshot.robotsTxt),
            )
        val checks =
            listOf(
                buildLlmsPresenceCheck(domain, snapshot),
                buildLlmsStructureCheck(snapshot),
                buildRobotsDirectivesCheck(snapshot, botMatrix),
                buildCitationLinksCheck(domain, snapshot),
                buildAiTxtCheck(snapshot),
            )

        return CrawlerEvaluationResult(
            domain = domain,
            measurementStatus = "measured",
            checks = checks,
            botMatrix = botMatrix,
            passCount = checks.count { it.status == "pass" },
            failCount = checks.count { it.status == "fail" },
        )
    }

    private fun unmeasuredResult(domain: String): CrawlerEvaluationResult =
        CrawlerEvaluationResult(
            domain = domain,
            measurementStatus = "not_measured",
            checks =
            listOf(
                ReadinessCheck("llms_txt", "llms.txt present", "not_measured", "Crawl not measured."),
                ReadinessCheck(
                    "llms_structure",
                    "llms.txt markdown structure",
                    "not_measured",
                    "Crawl not measured.",
                ),
                ReadinessCheck(
                    "ai_bot_directives",
                    "AI crawler directives in robots.txt",
                    "not_measured",
                    "Crawl not measured.",
                ),
                ReadinessCheck(
                    "cite_paths",
                    "Canonical citation links in llms.txt",
                    "not_measured",
                    "Crawl not measured.",
                ),
                ReadinessCheck("ai_txt", "ai.txt policy file", "not_measured", "Crawl not measured."),
            ),
            botMatrix = CANONICAL_AI_BOTS.map { BotDirectiveStatus(it, "not_measured") },
            passCount = 0,
            failCount = 0,
        )

    private fun isHttpSuccess(
        status: Int,
        body: String,
    ): Boolean = status in 200..299 && body.trim().isNotEmpty()

    private fun buildLlmsPresenceCheck(
        domain: String,
        snapshot: CrawlerFilesSnapshot,
    ): ReadinessCheck {
        if (snapshot.llmsHttpStatus <= 0) {
            return ReadinessCheck("llms_txt", "llms.txt present", "not_measured", "Not measured.")
        }
        val present = isHttpSuccess(snapshot.llmsHttpStatus, snapshot.llmsTxt)
        val detail =
            if (present) {
                "HTTP ${snapshot.llmsHttpStatus} (${snapshot.llmsTxt.length} chars)."
            } else {
                "HTTP ${snapshot.llmsHttpStatus} at /$domain/llms.txt."
            }
        return ReadinessCheck("llms_txt", "llms.txt present", if (present) "pass" else "fail", detail)
    }

    private fun buildLlmsStructureCheck(snapshot: CrawlerFilesSnapshot): ReadinessCheck {
        if (snapshot.llmsHttpStatus <= 0) {
            return ReadinessCheck(
                "llms_structure",
                "llms.txt markdown structure",
                "not_measured",
                "Not measured.",
            )
        }
        val present = isHttpSuccess(snapshot.llmsHttpStatus, snapshot.llmsTxt)
        val lines = snapshot.llmsTxt.lineSequence().map { it.trim() }.toList()
        val structured =
            present &&
                lines.any { it.startsWith("# ") } &&
                lines.any { it.startsWith("## ") || it.startsWith("> ") }
        val detail =
            if (structured) {
                "H1 title and summary/section headers verified."
            } else {
                "Add an H1 (# Brand), summary blockquote (> ...), and H2 sections."
            }
        return ReadinessCheck(
            "llms_structure",
            "llms.txt markdown structure",
            if (structured) "pass" else "fail",
            detail,
        )
    }

    private fun buildRobotsDirectivesCheck(
        snapshot: CrawlerFilesSnapshot,
        botMatrix: List<BotDirectiveStatus>,
    ): ReadinessCheck {
        if (snapshot.robotsHttpStatus <= 0) {
            return ReadinessCheck(
                "ai_bot_directives",
                "AI crawler directives in robots.txt",
                "not_measured",
                "Not measured.",
            )
        }
        val robotsPresent = isHttpSuccess(snapshot.robotsHttpStatus, snapshot.robotsTxt)
        val blockedCount = botMatrix.count { it.status == "blocked" }
        val passed = robotsPresent && blockedCount == 0
        val detail =
            when {
                !robotsPresent -> "robots.txt missing (HTTP ${snapshot.robotsHttpStatus})."
                blockedCount > 0 -> "$blockedCount AI crawler(s) blocked in robots.txt."
                else -> "Zero canonical AI crawlers blocked in robots.txt."
            }
        return ReadinessCheck(
            "ai_bot_directives",
            "AI crawler directives in robots.txt",
            if (passed) "pass" else "fail",
            detail,
        )
    }

    private fun buildCitationLinksCheck(
        domain: String,
        snapshot: CrawlerFilesSnapshot,
    ): ReadinessCheck {
        if (snapshot.llmsHttpStatus <= 0) {
            return ReadinessCheck(
                "cite_paths",
                "Canonical citation links in llms.txt",
                "not_measured",
                "Not measured.",
            )
        }
        val hasLinks =
            isHttpSuccess(snapshot.llmsHttpStatus, snapshot.llmsTxt) &&
                MARKDOWN_LINK_REGEX.containsMatchIn(snapshot.llmsTxt)
        val detail =
            if (hasLinks) {
                "Markdown links to canonical URLs found in llms.txt."
            } else {
                "Include [Page Title](https://$domain/...) links in llms.txt."
            }
        return ReadinessCheck(
            "cite_paths",
            "Canonical citation links in llms.txt",
            if (hasLinks) "pass" else "fail",
            detail,
        )
    }

    private fun buildAiTxtCheck(snapshot: CrawlerFilesSnapshot): ReadinessCheck {
        if (snapshot.aiHttpStatus <= 0) {
            return ReadinessCheck("ai_txt", "ai.txt policy file", "not_measured", "Not measured.")
        }
        val present = isHttpSuccess(snapshot.aiHttpStatus, snapshot.aiTxt)
        val detail =
            if (present) {
                "HTTP ${snapshot.aiHttpStatus} (${snapshot.aiTxt.length} chars)."
            } else {
                "Optional /ai.txt returned HTTP ${snapshot.aiHttpStatus}."
            }
        return ReadinessCheck("ai_txt", "ai.txt policy file", if (present) "pass" else "fail", detail)
    }

    private fun parseBotMatrix(
        robotsTxt: String,
        robotsMeasured: Boolean,
        robotsPresent: Boolean,
    ): List<BotDirectiveStatus> {
        if (!robotsMeasured) {
            return CANONICAL_AI_BOTS.map { BotDirectiveStatus(it, "not_measured") }
        }
        if (!robotsPresent) {
            return CANONICAL_AI_BOTS.map { BotDirectiveStatus(it, "not_specified") }
        }

        val sections = parseRobotsSections(robotsTxt)
        val wildcardRules = sections["*"].orEmpty()
        return CANONICAL_AI_BOTS.map { bot ->
            val rules = sections[bot.lowercase(Locale.ROOT)] ?: wildcardRules
            val status = if (rules.isEmpty()) "not_specified" else classifyRules(rules)
            BotDirectiveStatus(bot = bot, status = status)
        }
    }

    private fun parseRobotsSections(robotsTxt: String): Map<String, List<Pair<String, String>>> {
        val sections = mutableMapOf<String, MutableList<Pair<String, String>>>()
        val currentAgents = mutableListOf<String>()
        var seenRulesInBlock = false

        for (rawLine in robotsTxt.lineSequence()) {
            val line = rawLine.substringBefore('#').trim()
            if (!line.contains(':')) continue
            val key = line.substringBefore(':').trim().lowercase(Locale.ROOT)
            val value = line.substringAfter(':').trim()
            if (key == "user-agent") {
                if (seenRulesInBlock) {
                    currentAgents.clear()
                    seenRulesInBlock = false
                }
                val agent = value.lowercase(Locale.ROOT)
                currentAgents.add(agent)
                sections.putIfAbsent(agent, mutableListOf())
            } else if (key == "allow" || key == "disallow") {
                seenRulesInBlock = true
                currentAgents.forEach { agent ->
                    sections.getOrPut(agent) { mutableListOf() }.add(key to value)
                }
            }
        }
        return sections
    }

    private fun classifyRules(rules: List<Pair<String, String>>): String {
        val blocksRoot = rules.any { (k, v) -> k == "disallow" && v.trim() == "/" }
        val allowsRoot = rules.any { (k, v) -> k == "allow" && (v.trim() == "/" || v.trim().isEmpty()) }
        val emptyDisallow = rules.any { (k, v) -> k == "disallow" && v.trim().isEmpty() }
        return when {
            blocksRoot && !allowsRoot -> "blocked"
            allowsRoot || emptyDisallow -> "allowed"
            else -> "not_specified"
        }
    }
}
