package com.luminarasuite.app.core.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.net.URI
import java.util.Locale
import kotlin.math.roundToInt

data class CrewSchema(
    val type: String,
    val name: String?,
)

data class CrewPage(
    val url: String,
    val title: String,
    val siteName: String? = null,
    val httpStatus: Int? = null,
    val schemas: List<CrewSchema> = emptyList(),
    val wordCount: Int = 0,
    val textSnippet: String = "",
)

data class SearchRow(
    val query: String,
    val title: String,
    val url: String,
    val snippet: String,
    val brandMentioned: Boolean,
)

data class CrewFinding(
    val id: String,
    val category: String,
    val severity: String,
    val title: String,
    val description: String,
    val evidence: String,
)

data class HealthChecklist(
    val passed: Int,
    val failed: Int,
    val total: Int,
) {
    val line: String
        get() = if (failed > 0) "$passed of $total checks passed, $failed failed" else "$passed of $total checks passed"
}

data class FixDraft(
    val id: String,
    val filename: String,
    val snippet: String,
    val explanation: String,
)

data class CrewBrief(
    val heading: String,
    val scoreLine: String,
    val takeaway: String,
    val steps: List<String>,
) {
    fun asText(): String =
        buildString {
            appendLine(heading)
            appendLine(scoreLine)
            appendLine(takeaway)
            steps.forEachIndexed { index, step -> appendLine("${index + 1}. $step") }
        }.trim()
}

data class CrewResult(
    val pages: List<CrewPage>,
    val searchRows: List<SearchRow>,
    val citationRatePercent: Int?,
    val shareOfVoice: Int?,
    val healthScore: Int?,
    val measurementStatus: String,
    val checklist: HealthChecklist?,
    val findings: List<CrewFinding>,
    val fixes: List<FixDraft>,
    val brief: CrewBrief,
)

/** Same-entity rules from services/audit/entityMatch.ts: a shared stem is a different organization. */
object EntityMatch {
    private const val MIN_STEM = 4
    private val HOST_IN_TEXT = Regex("\\b(?:[a-z0-9-]+\\.)+[a-z]{2,}\\b")

    fun auditedHost(input: String): String {
        val noScheme = input.trim().lowercase(Locale.ROOT).replace(Regex("^https?://"), "")
        val host = noScheme.substringBefore('/').substringBefore('?').substringBefore('#').substringBefore(':')
        return host.removePrefix("www.")
    }

    fun sameSite(
        host: String,
        auditedDomain: String,
    ): Boolean {
        val left = auditedHost(host)
        val right = auditedHost(auditedDomain)
        return left.isNotEmpty() && right.isNotEmpty() && (left == right || left.endsWith(".$right"))
    }

    private fun isNamesakeHost(
        host: String,
        auditedDomain: String,
    ): Boolean {
        val left = auditedHost(host)
        val right = auditedHost(auditedDomain)
        if (!left.contains('.') || right.isEmpty() || sameSite(left, right)) return false
        val stem = right.substringBefore('.')
        if (stem.length < MIN_STEM) return false
        return left.split('.').dropLast(1).contains(stem)
    }

    private fun textHasHost(
        text: String,
        host: String,
    ): Boolean =
        Regex(
            "(?:^|[^a-z0-9-])${Regex.escape(host)}(?=$|[^a-z0-9.-]|\\.(?![a-z0-9]))",
            RegexOption.IGNORE_CASE,
        ).containsMatchIn(text)

    private fun distinctPhrase(
        brand: String,
        stem: String,
    ): String? {
        val normalized = brand.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), " ").trim()
        if (normalized.isEmpty() || normalized == stem) return null
        val tokens = normalized.split(Regex("\\s+")).filter { it.length > 1 }
        return when {
            tokens.isEmpty() -> null
            tokens.size == 1 -> tokens[0].takeIf { it != stem }
            else -> tokens.joinToString(" ")
        }
    }

    private fun wordsPresent(
        text: String,
        words: List<String>,
    ): Boolean {
        val pattern = words.joinToString("\\W+") { Regex.escape(it) }
        return Regex("(?:^|\\W)$pattern(?:$|\\W)", RegexOption.IGNORE_CASE).containsMatchIn(text)
    }

    /** True only for the "same" outcome of classifyMention. A namesake or an unrelated row is not a mention. */
    fun mentionsAudited(
        domain: String,
        brandName: String,
        url: String,
        title: String,
        text: String,
    ): Boolean {
        val audited = auditedHost(domain)
        if (!audited.contains('.')) return false
        val urlHost = runCatching { URI(url.trim()).host }.getOrNull()?.let(::auditedHost).orEmpty()
        if (urlHost.isNotEmpty() && sameSite(urlHost, audited)) return true
        if (urlHost.isNotEmpty() && isNamesakeHost(urlHost, audited)) return false

        val blob = "$title $text"
        if (textHasHost(blob, audited) || textHasHost(url, audited)) return true
        val phrase = distinctPhrase(brandName, audited.substringBefore('.')) ?: return false
        val hosts = HOST_IN_TEXT.findAll("$blob $url".lowercase(Locale.ROOT)).map { it.value }
        return wordsPresent(blob, phrase.split(' ')) && hosts.none { isNamesakeHost(it, audited) }
    }
}

/** Name rules from services/audit/brandName.ts. Never a title-cased domain, except through readableStem. */
object BrandName {
    private val GENERIC =
        Regex("^(www|home|welcome|index|untitled|official site|official website)$", RegexOption.IGNORE_CASE)
    private val SEPARATOR = Regex("\\s+[|:]\\s+|\\s+-\\s+|\\s+\u2013\\s+|\\s+\u2014\\s+")
    private val SPACES = Regex("\\s+")
    private const val MAX_NAME = 80

    private fun cleanName(value: String?): String {
        val raw = value.orEmpty().replace(SPACES, " ").trim()
        val rejected =
            raw.isEmpty() ||
                raw.length > MAX_NAME ||
                GENERIC.matches(raw) ||
                raw.lowercase(Locale.ROOT).startsWith("http") ||
                (raw.contains('.') && !raw.contains(' '))
        return if (rejected) "" else raw
    }

    private fun named(value: String?): String? {
        val raw = value.orEmpty().replace(SPACES, " ").trim()
        if (raw.isEmpty()) return null
        return cleanName(raw.split(SEPARATOR).first().trim()).ifEmpty { null }
    }

    fun fromPage(page: CrewPage?): String? =
        named(page?.siteName)
            ?: named(page?.schemas?.firstOrNull { isOrganizationType(it.type) && !it.name.isNullOrBlank() }?.name)
            ?: named(page?.title)

    fun readableStem(host: String): String {
        val stem = EntityMatch.auditedHost(host).substringBefore('.')
        val words = stem.split('-', '_').filter { it.isNotEmpty() }
        if (words.isEmpty()) return "Site"
        return words.joinToString(" ") { word ->
            word.lowercase(Locale.ROOT).replaceFirstChar { it.titlecase(Locale.ROOT) }
        }
    }

    fun isOrganizationType(type: String): Boolean {
        val trimmed = type.trim().lowercase(Locale.ROOT)
        val leaf = trimmed.substringAfterLast('/').substringAfterLast(':').substringBefore('#').trim()
        return leaf.isNotEmpty() &&
            (
                leaf.endsWith("organization") ||
                    leaf in setOf("corporation", "localbusiness", "professionalservice", "realestateagent")
                )
    }
}

/** The structured-data blocks a page declares, read from its raw HTML. */
object PageSchemas {
    private val SCRIPT =
        Regex(
            "<script[^>]*type\\s*=\\s*[\"']application/ld\\+json[\"'][^>]*>(.*?)</script>",
            setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
        )
    private val LENIENT = Json { isLenient = true }

    fun extract(html: String): List<CrewSchema> =
        SCRIPT.findAll(html).flatMap { match ->
            val root = runCatching { LENIENT.parseToJsonElement(match.groupValues[1].trim()) }.getOrNull()
            root?.let(::blocks).orEmpty()
        }.toList()

    private fun blocks(element: JsonElement): List<CrewSchema> =
        when (element) {
            is JsonArray -> element.flatMap(::blocks)
            is JsonObject -> {
                val name = (element["name"] as? JsonPrimitive)?.contentOrNull
                val types =
                    when (val type = element["@type"]) {
                        is JsonPrimitive -> listOfNotNull(type.contentOrNull)
                        is JsonArray -> type.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                        else -> emptyList()
                    }
                types.map { CrewSchema(it, name) } + element["@graph"]?.let(::blocks).orEmpty()
            }
            else -> emptyList()
        }
}

/**
 * The deterministic crew checks, mirroring services/agentCore (auditEvidenceGate, playbookAuditorAgent,
 * serpRadarAgent, remediationArchitectAgent, executiveTranslatorAgent). A number exists only when a live
 * page and live search rows both exist, otherwise it stays null and the UI shows not_measured.
 */
@Suppress("TooManyFunctions") // One function per rule, mirroring the crew sources named above.
object CrewRules {
    const val HEALTH_SCORE_START = 85
    private const val HEALTH_FLOOR = 20
    private const val HEALTH_CEILING = 100
    private const val THIN_WORDS = 250
    private const val MAX_SNIPPET = 1500
    private const val BLOCK_SAMPLE = 2500
    private const val PERCENT = 100.0
    private val SAMPLE_WORD = Regex("\\bSAMPLE\\b")
    private val SPACED_PUNCTUATION = Regex("\\s+([,.;:!?])")
    private val SEVERITY_RANK = mapOf("critical" to 0, "high" to 1, "medium" to 2, "low" to 3)

    private val HEALTH_PENALTIES =
        linkedMapOf(
            "finding-zero-citations" to 15,
            "finding-schema-org" to 12,
            "finding-deprecated-howto" to 5,
            "finding-thin-content" to 8,
        )

    private val STEP_FOR_FAILED_CHECK =
        mapOf(
            "finding-zero-citations" to
                "Say plainly what you offer: None of the web results this run collected mention your brand. " +
                "Publish one page under your brand name that states what you offer and who it is for.",
            "finding-schema-org" to
                "Add a business identity tag: No business identity tag was found on the pages this run read. " +
                "Add the generated tag to your website header. It states who you are in a form machines read.",
            "finding-deprecated-howto" to
                "Remove the HowTo markup: Your pages carry HowTo schema, which the playbook marks as deprecated.",
            "finding-thin-content" to
                "Write fuller answers on thin pages: At least one page this run read has fewer than 250 words. " +
                "Add clear, 2-to-3 sentence answers to the questions your buyers ask before buying.",
        )

    fun countPhrase(
        count: Int,
        singular: String,
    ): String = if (count == 1) "1 $singular" else "$count ${singular}s"

    fun wordCount(markdown: String): Int = markdown.trim().split(Regex("\\s+")).count { it.isNotEmpty() }

    fun snippet(markdown: String): String = markdown.take(MAX_SNIPPET)

    private fun joinList(items: List<String>): String =
        when (items.size) {
            0 -> ""
            1 -> items[0]
            else -> "${items.dropLast(1).joinToString(", ")} and ${items.last()}"
        }

    private fun tidy(text: String): String = text.replace(SPACED_PUNCTUATION, "$1").trim()

    private fun pageBlocked(page: CrewPage): Boolean {
        if (page.httpStatus == HTTP_FORBIDDEN || page.httpStatus == HTTP_TOO_MANY) return true
        val sample = "${page.title}\n${page.textSnippet}".take(BLOCK_SAMPLE).lowercase(Locale.ROOT)
        return listOf("cf-challenge", "cf-browser-verification", "just a moment", "checking your browser")
            .any { it in sample }
    }

    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_TOO_MANY = 429

    fun pageIsLive(page: CrewPage): Boolean =
        !pageBlocked(page) &&
            (page.wordCount > 0 || page.schemas.isNotEmpty() || page.textSnippet.isNotBlank())

    fun isSampleRow(row: SearchRow): Boolean {
        val blob = listOf(row.title, row.snippet, row.query, row.url).joinToString(" ")
        return SAMPLE_WORD.containsMatchIn(blob) || blob.contains("why-sample", ignoreCase = true)
    }

    fun searchQueries(
        domain: String,
        brandName: String?,
    ): List<String> {
        val brand = brandName?.trim().orEmpty().ifEmpty { domain.substringBefore('.') }
        return listOf("\"$brand\" $domain", "best $brand alternative reviews", "what is $domain")
    }

    fun citationRate(rows: List<SearchRow>): Int? {
        if (rows.isEmpty()) return null
        return (rows.count { it.brandMentioned } * PERCENT / rows.size).roundToInt()
    }

    private fun citationFinding(rows: List<SearchRow>): CrewFinding? {
        if (rows.isEmpty() || rows.any { it.brandMentioned }) return null
        val queries = rows.map { it.query }.filter { it.isNotEmpty() }.distinct().take(3)
        val queryList = if (queries.isEmpty()) "the searches in this run" else joinList(queries.map { "\"$it\"" })
        return CrewFinding(
            id = "finding-zero-citations",
            category = "citations",
            severity = "critical",
            title = "Web results do not name your business",
            description = tidy("None of the ${countPhrase(rows.size, "result")} for $queryList name your business."),
            evidence = tidy("0 of ${rows.size} results for $queryList named your business."),
        )
    }

    private fun identityFinding(pages: List<CrewPage>): CrewFinding? {
        val measured = pages.map { page ->
            page to page.schemas.map { it.type.trim().lowercase(Locale.ROOT) }.distinct()
        }
        val hasOrg = { types: List<String> -> types.any(BrandName::isOrganizationType) }
        if (measured.none { hasOrg(it.second) }) {
            val urls = joinList(measured.map { it.first.url }.take(3))
            val seen = measured.flatMap { it.second }.distinct().filter { it.isNotEmpty() }
            val seenLabel = if (seen.isEmpty()) "none" else joinList(seen)
            return CrewFinding(
                id = "finding-schema-org",
                category = "schema",
                severity = "critical",
                title = "Add a business identity tag on $urls",
                description = tidy("Tags on the page: $seenLabel. A business identity tag was not among them."),
                evidence = tidy("Read ${countPhrase(measured.size, "page")} at $urls. Tags on the page: $seenLabel."),
            )
        }
        val missing = measured.filterNot { hasOrg(it.second) }
        if (missing.isEmpty()) return null
        val quoted =
            missing.take(3).joinToString("; ") { (page, types) ->
                "${page.url}: ${if (types.isEmpty()) "no tags" else types.joinToString(", ")}"
            }
        return CrewFinding(
            id = "finding-schema-org-partial",
            category = "schema",
            severity = "low",
            title = "A business identity tag is not on every page we read",
            description = "Other pages we read already include a business identity tag. These do not: $quoted.",
            evidence = quoted,
        )
    }

    private fun howToFinding(pages: List<CrewPage>): CrewFinding? {
        val urls = pages.filter { page ->
            page.schemas.any { it.type.equals("howto", ignoreCase = true) }
        }.map { it.url }
        if (urls.isEmpty()) return null
        val where = joinList(urls.take(3))
        return CrewFinding(
            id = "finding-deprecated-howto",
            category = "schema",
            severity = "medium",
            title = "Remove the outdated how-to tag",
            description = tidy("A how-to tag is on $where. That tag is no longer used for rich results."),
            evidence = tidy("A how-to tag was on $where."),
        )
    }

    private fun thinFinding(pages: List<CrewPage>): CrewFinding? {
        val thin = pages.filter { it.wordCount in 1 until THIN_WORDS }
        if (thin.isEmpty()) return null
        val list = thin.joinToString("; ") { "${it.url} (${it.wordCount} words)" }
        return CrewFinding(
            id = "finding-thin-content",
            category = "content_quality",
            severity = "high",
            title = if (thin.size == 1) "This page is too short" else "These pages are too short",
            description = tidy("$list ${if (thin.size == 1) "has" else "have"} fewer than 250 words."),
            evidence = list,
        )
    }

    private fun healthScore(findings: List<CrewFinding>): Int =
        HEALTH_PENALTIES.entries
            .fold(HEALTH_SCORE_START) { score, (id, penalty) ->
                if (findings.any { it.id == id }) score - penalty else score
            }.coerceIn(HEALTH_FLOOR, HEALTH_CEILING)

    private fun crawlerFailed(
        checks: List<ReadinessCheck>,
        vararg ids: String,
    ): Boolean = checks.any { it.id in ids && it.status == "fail" }

    private fun crawlerSteps(checks: List<ReadinessCheck>): List<String> =
        buildList {
            if (crawlerFailed(checks, "ai_bot_directives")) {
                add(
                    "Let crawlers read public pages in robots.txt: robots.txt blocks one or more named AI " +
                        "crawlers. Allow them on the public pages you want quoted.",
                )
            }
            if (crawlerFailed(checks, "llms_txt")) {
                add(
                    "Add a short page at /llms.txt: No llms.txt text file was found at the site root. Add one " +
                        "with a title and a short summary of what you sell. The file is a hint, not a score.",
                )
            } else if (crawlerFailed(checks, "llms_structure")) {
                add(
                    "Give /llms.txt a title and a short summary: llms.txt is there but is missing a title or a " +
                        "short summary. Add both at the top. The file is a hint, not a score.",
                )
            }
            if (crawlerFailed(checks, "ai_txt")) {
                add(
                    "Optional: add /ai.txt: No ai.txt text file was found at the site root. It is optional. " +
                        "Write your own policy for how AI tools may use your pages.",
                )
            }
        }

    private fun fixDrafts(
        domain: String,
        displayName: String?,
        findings: List<CrewFinding>,
        checks: List<ReadinessCheck>,
    ): List<FixDraft> =
        buildList {
            val brand = displayName ?: BrandName.readableStem(domain)
            if (findings.any { it.id == "finding-schema-org" || it.id == "finding-schema-org-partial" }) {
                val escaped = brand.replace("\\", "\\\\").replace("\"", "\\\"")
                add(
                    FixDraft(
                        id = "patch-schema-org",
                        filename = "schema-organization.jsonld",
                        snippet =
                        """
                        {
                          "@context": "https://schema.org",
                          "@type": "Organization",
                          "name": "$escaped",
                          "url": "https://$domain",
                          "description": "$escaped official web presence and services."
                        }
                        """.trimIndent(),
                        explanation = "Draft Organization tag for the page header. Check the name and URL first.",
                    ),
                )
            }
            if (crawlerFailed(checks, "llms_txt", "llms_structure")) {
                val title = displayName ?: "<Your business name>"
                add(
                    FixDraft(
                        id = "patch-llms-txt",
                        filename = "llms.txt",
                        snippet = "# $title\n\n## Pages\n- Official website: https://$domain\n",
                        explanation = "Draft llms.txt for the site root. Check the text before pasting.",
                    ),
                )
            }
        }

    private fun buildBrief(
        brand: String,
        checklist: HealthChecklist?,
        rows: List<SearchRow>,
        citation: Int?,
        findings: List<CrewFinding>,
        checks: List<ReadinessCheck>,
    ): CrewBrief {
        val mentions = rows.count { it.brandMentioned }.takeIf { citation != null }
        val scoreLine =
            when {
                checklist != null && mentions != null ->
                    "Right now, ${checklist.line} this run, and your brand is mentioned in $mentions of " +
                        "${rows.size} web results this run collected."
                checklist != null -> "Right now, ${checklist.line} this run. Citation rate was not measured."
                mentions != null ->
                    "Right now, your brand is mentioned in $mentions of ${rows.size} web results this run " +
                        "collected. The site checks were not measured."
                else ->
                    "Right now, the site checks and citation rate were not measured. Search or page providers " +
                        "did not return evidence for this run."
            }
        val critical = findings.filter { it.severity == "critical" }
        val failed = checklist?.failed ?: 0
        val crawler = crawlerSteps(checks)
        val takeaway =
            when {
                critical.isNotEmpty() ->
                    "This run found ${countPhrase(critical.size, "critical gap")}: " +
                        critical.joinToString("; ") { it.title } + "."
                failed > 0 -> if (failed == 1) "1 check failed." else "$failed checks failed."
                crawler.isNotEmpty() -> "The site checks are clear. The crawler files still need work."
                checklist != null -> "None of the checks this run made found a critical gap."
                else -> "This run did not measure enough page or search evidence to judge the site."
            }
        val steps =
            HEALTH_PENALTIES.keys.mapNotNull { id ->
                val finding = findings.firstOrNull { it.id == id } ?: return@mapNotNull null
                "${STEP_FOR_FAILED_CHECK.getValue(id)} ${finding.evidence}"
            } + crawler
        return CrewBrief("What this means for $brand", scoreLine, takeaway, steps)
    }

    fun assess(
        domain: String,
        pages: List<CrewPage>,
        searchRows: List<SearchRow>,
        crawlerChecks: List<ReadinessCheck>,
    ): CrewResult {
        val livePages = pages.filter(::pageIsLive)
        val liveRows = searchRows.filterNot(::isSampleRow)
        val citation = citationRate(liveRows)
        val findings =
            buildList {
                citationFinding(liveRows)?.let(::add)
                if (livePages.isNotEmpty()) {
                    identityFinding(livePages)?.let(::add)
                    howToFinding(livePages)?.let(::add)
                    thinFinding(livePages)?.let(::add)
                }
            }
        val scored = livePages.isNotEmpty() && liveRows.isNotEmpty()
        val health = if (scored) healthScore(findings) else null
        val checklist =
            if (scored) {
                val failed = HEALTH_PENALTIES.keys.count { id -> findings.any { it.id == id } }
                HealthChecklist(HEALTH_PENALTIES.size - failed, failed, HEALTH_PENALTIES.size)
            } else {
                null
            }
        val displayName = BrandName.fromPage(livePages.firstOrNull())
        return CrewResult(
            pages = pages,
            searchRows = liveRows,
            citationRatePercent = citation,
            shareOfVoice = liveRows.count { it.brandMentioned }.takeIf { citation != null },
            healthScore = health,
            measurementStatus = if (health != null && citation != null) "measured" else "not_measured",
            checklist = checklist,
            findings = findings,
            fixes = if (health != null) fixDrafts(domain, displayName, findings, crawlerChecks) else emptyList(),
            brief =
            buildBrief(
                brand = displayName ?: BrandName.readableStem(domain),
                checklist = checklist,
                rows = liveRows,
                citation = citation,
                findings = findings,
                checks = crawlerChecks,
            ),
        )
    }

    /** services/audit/reportBlocks.ts pickPrimaryFinding: open work first, then the most severe. */
    fun pickNextFix(findings: List<AuditFinding>): AuditFinding? {
        val eligible = findings.filterNot { it.id.endsWith("-unmeasured") }
        val open = eligible.filter { it.status == "open" || it.status == "in_progress" }
        return open.ifEmpty { eligible }.minByOrNull { SEVERITY_RANK[it.severity] ?: Int.MAX_VALUE }
    }

    private fun fnv1a(input: String): String {
        var hash = FNV_OFFSET
        input.forEach { char -> hash = (hash xor char.code) * FNV_PRIME }
        return hash.toUInt().toString(16).padStart(8, '0')
    }

    private const val FNV_OFFSET = -2128831035 // 0x811c9dc5 as a signed Int.
    private const val FNV_PRIME = 0x01000193

    /** services/audit/findingStableKey.ts, so a web re-audit updates the same work item. */
    fun stableKey(
        domain: String,
        category: String,
        title: String,
    ): String {
        val cleanTitle = title.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), " ").trim()
        val material = "${EntityMatch.auditedHost(domain)}|${category.trim().lowercase(Locale.ROOT)}|$cleanTitle"
        return "fk_${fnv1a(material)}_${fnv1a(material.reversed())}"
    }
}
