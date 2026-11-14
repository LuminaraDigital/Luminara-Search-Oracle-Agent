package com.luminarasuite.app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
data class ProbeCrawlResponse(
    val ok: Boolean = false,
    val host: String = "",
    val crawl: ProbeCrawlData = ProbeCrawlData(),
    val snapshot: ProbeSnapshot = ProbeSnapshot(),
)

@Serializable
data class ProbeCrawlData(
    val status: String = "not_measured",
    val note: String = "",
    val robotsPresent: Boolean? = null,
    val llmsPresent: Boolean? = null,
    val aiTxtPresent: Boolean? = null,
)

@Serializable
data class ProbeSnapshot(
    val robotsHttpStatus: Int = 0,
    val llmsHttpStatus: Int = 0,
    val aiHttpStatus: Int = 0,
)

@Serializable
data class CrawlerFilesResponse(
    val ok: Boolean = false,
    val snapshot: CrawlerFilesSnapshot = CrawlerFilesSnapshot(),
)

@Serializable
data class CrawlerFilesSnapshot(
    val llmsTxt: String = "",
    val llmsHttpStatus: Int = 0,
    val robotsTxt: String = "",
    val robotsHttpStatus: Int = 0,
    val aiTxt: String = "",
    val aiHttpStatus: Int = 0,
)

data class ReadinessCheck(
    val id: String,
    val label: String,
    val status: String,
    val detail: String,
)

data class BotDirectiveStatus(
    val bot: String,
    val status: String,
)

data class CrawlerEvaluationResult(
    val domain: String,
    val measurementStatus: String,
    val checks: List<ReadinessCheck>,
    val botMatrix: List<BotDirectiveStatus>,
    val passCount: Int,
    val failCount: Int,
)

@Serializable
data class GatewayExecuteRequest(
    val targetDomain: String,
    val focus: String = "AEO",
    val surface: String = "web",
    val options: GatewayExecuteOptions = GatewayExecuteOptions(),
)

@Serializable
data class GatewayExecuteOptions(
    val plainEnglish: Boolean = true,
    val includeSchemaDiff: Boolean = false,
)

@Serializable
data class GatewayExecuteResponse(
    val ok: Boolean = false,
    val taskId: String = "",
    val runId: String? = null,
    val targetDomain: String = "",
    val focus: String = "AEO",
    val state: String = "settled",
    val verdict: String = "",
    val oneMoveThisWeek: String = "",
    val healthScore: Int? = null,
    val evidence: GatewayEvidence = GatewayEvidence(),
    val receiptIssued: Boolean = false,
    val receiptNote: String = "",
)

@Serializable
data class GatewayEvidence(
    val measurementStatus: String = "not_measured",
)

@Serializable
data class ScoutRecheckRequest(
    val recheck: Boolean = true,
    val domain: String,
    val checkId: String,
    val expect: String? = null,
)

@Serializable
data class ScoutRecheckResponse(
    val ok: Boolean = false,
    val checkId: String = "",
    val label: String = "",
    val measured: Boolean = false,
    val passed: Boolean? = null,
    val detail: String = "",
)

@Serializable
data class WorkerErrorPayload(
    val ok: Boolean = false,
    val error: String = "",
    val code: String = "",
)

@Serializable
data class AuditHistoryEntry(
    val id: String,
    val domain: String,
    val focus: String = "AEO",
    val measuredAt: Long,
    val healthScore: Int? = null,
    val citationRatePercent: Int? = null,
    val schemaGapCount: Int? = null,
    val topCompetitor: String? = null,
    val competitorsMentioned: List<String> = emptyList(),
    val title: String,
    val summary: String,
    val reportExcerpt: String = "",
    val clientId: String? = null,
    val tags: List<String> = emptyList(),
)

@Serializable
data class AuditHistoryListResponse(
    val ok: Boolean = false,
    val accountId: String = "",
    val entries: List<AuditHistoryEntry> = emptyList(),
)

@Serializable
data class AuditHistoryUpsertRequest(
    val entry: AuditHistoryEntry,
)

@Serializable
data class AuditHistoryUpsertResponse(
    val ok: Boolean = false,
    val entry: AuditHistoryEntry? = null,
)

@Serializable
data class AuditFinding(
    val id: String,
    val auditRunId: String = "",
    val domain: String,
    val stableKey: String = "",
    val category: String = "technical",
    val severity: String = "high",
    val title: String,
    val description: String,
    val status: String = "open",
    val owner: String? = null,
    val dueAt: Long? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val clientId: String? = null,
)

@Serializable
data class FindingsListResponse(
    val ok: Boolean = false,
    val findings: List<AuditFinding> = emptyList(),
)

@Serializable
data class FindingPatchRequest(
    val status: String,
)

@Serializable
data class FindingPatchResponse(
    val ok: Boolean = false,
    val finding: AuditFinding? = null,
)

@Serializable
data class FindingsBulkItem(
    val id: String? = null,
    val stableKey: String? = null,
    val category: String,
    val severity: String,
    val title: String,
    val description: String,
    val status: String = "open",
)

@Serializable
data class FindingsBulkRequest(
    val domain: String,
    val auditRunId: String? = null,
    val findings: List<FindingsBulkItem>,
)

@Serializable
data class FindingsBulkResponse(
    val ok: Boolean = false,
    val findings: List<AuditFinding> = emptyList(),
)

@Serializable
data class AuthCredentialsRequest(
    val email: String,
    val password: String,
)

@Serializable
data class AuthTokenResponse(
    val ok: Boolean = false,
    val idToken: String = "",
    val refreshToken: String = "",
    val localId: String = "",
    val email: String = "",
    val expiresIn: String = "3600",
    val error: String? = null,
    val code: String? = null,
)

@Serializable
data class HostedIdentity(
    val id: String = "",
    val source: String = "firebase",
    val email: String = "",
    val name: String = "",
    val accountId: String = "",
)

@Serializable
data class HostedEntitlement(
    val tier: String = "free",
    val name: String = "Free",
    val status: String = "none",
)

@Serializable
data class QuotaStatus(
    val ok: Boolean = false,
    val authenticated: Boolean = false,
    val accountId: String = "",
    val plan: String = "free",
    val limit: Int = 3,
    val used: Int = 0,
    val remaining: Int = 3,
    val bonusRemaining: Int = 0,
    val resetSec: Int = 0,
    val isUnlimited: Boolean = false,
    /** Questions left today. -1 means the server did not send a counter, or the plan has no cap. */
    val askLimit: Int = -1,
    val askUsed: Int = 0,
    val askRemaining: Int = -1,
    val entitlement: HostedEntitlement? = null,
)

@Serializable
data class BootResponse(
    val ok: Boolean = false,
    val accountId: String = "",
    val user: HostedIdentity? = null,
    val quota: QuotaStatus? = null,
)

@Serializable
data class AccountDeleteRequest(
    val confirm: String,
    val idToken: String,
)

@Serializable
data class AccountDeleteResponse(
    val ok: Boolean = false,
    val rows: Int = 0,
    val firebaseDeleted: Boolean = false,
    val error: String? = null,
    val code: String? = null,
)

@Serializable
data class PrivacyExportResponse(
    val ok: Boolean = false,
    val jobId: String = "",
    val status: String = "",
    val downloadToken: String = "",
    val expiresAt: Long = 0L,
    val message: String = "",
)

@Serializable
data class GroqMessage(
    val role: String,
    val content: String = "",
)

@Serializable
data class GroqChatRequest(
    val model: String = "openai/gpt-oss-120b",
    val messages: List<GroqMessage>,
    val temperature: Double = 0.2,
    @SerialName("max_tokens")
    val maxTokens: Int = 1024,
    val stream: Boolean = false,
)

/** Body for `/api/oracle/chat`. The server keeps the session by account, so only the question is sent. */
@Serializable
data class OracleChatRequest(
    val message: String,
)

@Serializable
data class GroqChatResponse(
    val choices: List<GroqChoice> = emptyList(),
)

@Serializable
data class GroqChoice(
    val message: GroqMessage = GroqMessage(role = "assistant", content = ""),
)

@Serializable
data class TavilySearchRequest(
    val query: String,
    @SerialName("search_depth")
    val searchDepth: String = "basic",
    @SerialName("include_answer")
    val includeAnswer: Boolean = true,
    @SerialName("max_results")
    val maxResults: Int = 4,
)

@Serializable
data class TavilySearchResponse(
    val answer: String? = null,
    val results: List<TavilyResult> = emptyList(),
)

@Serializable
data class TavilyResult(
    val title: String = "",
    val url: String = "",
    val content: String = "",
)

data class ByokKeyBag(
    val groqKey: String = "",
    val nimKey: String = "",
    val geminiKey: String = "",
    val tavilyKey: String = "",
) {
    val hasAnyLlmKey: Boolean
        get() = groqKey.isNotBlank() || nimKey.isNotBlank() || geminiKey.isNotBlank()
}

data class OracleTurn(
    val id: String,
    val question: String,
    val verdict: String,
    val nextAction: String,
    val sources: List<TavilyResult>,
    val modelLabel: String,
    val measurementStatus: String,
    val timestampMs: Long,
    val isReported: Boolean = false,
)

@Serializable
data class GroqStreamChunk(
    val choices: List<GroqStreamChoice> = emptyList(),
)

@Serializable
data class GroqStreamChoice(
    val delta: GroqStreamDelta = GroqStreamDelta(),
)

@Serializable
data class GroqStreamDelta(
    val content: String? = null,
)

@Serializable
data class AuthRefreshRequest(
    val refreshToken: String,
)

@Serializable
data class AuthRefreshResponse(
    val ok: Boolean = false,
    val idToken: String = "",
    val refreshToken: String = "",
    val error: String? = null,
)

@Serializable
data class FirecrawlMapRequest(
    val url: String,
    val limit: Int,
    val includeSubdomains: Boolean = false,
    val ignoreSitemap: Boolean = false,
)

@Serializable
data class FirecrawlMapResponse(
    val links: List<JsonElement> = emptyList(),
)

@Serializable
data class FirecrawlScrapeRequest(
    val url: String,
    val formats: List<String> = listOf("markdown", "rawHtml"),
    val onlyMainContent: Boolean = true,
    val waitFor: Int = 1000,
)

@Serializable
data class FirecrawlScrapeResponse(
    val data: FirecrawlPage? = null,
)

@Serializable
data class FirecrawlPage(
    val markdown: String = "",
    val rawHtml: String = "",
    val metadata: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class AuditRunRequest(
    val domain: String,
)

@Serializable
data class AuditRunResponse(
    val token: String = "",
    val domain: String = "",
)

@Serializable
data class IdeaCreateRequest(
    val idea: String,
    val niche: String? = null,
    val competitorUrls: List<String> = emptyList(),
    val pulseOptIn: Boolean = false,
)

@Serializable
data class IdeaCreateResponse(
    val ok: Boolean = false,
    val id: String = "",
    val card: IdeaCard? = null,
    val ideaCardsRemaining: Int? = null,
)

@Serializable
data class IdeaDetailResponse(
    val ok: Boolean = false,
    val card: IdeaCard? = null,
    val niche: String? = null,
)

@Serializable
data class IdeaListResponse(
    val ok: Boolean = false,
    val ideas: List<IdeaSummary> = emptyList(),
)

@Serializable
data class IdeaSummary(
    val id: String = "",
    val ideaText: String = "",
    val niche: String? = null,
    val status: String = "",
    val createdAt: Long = 0L,
    val linkedDomain: String? = null,
)

@Serializable
data class IdeaCard(
    val problem: String = "",
    val whoAsksAi: IdeaWhoAsks = IdeaWhoAsks(),
    val competitorCitation: IdeaCitation = IdeaCitation(),
    val contentBets: List<IdeaBet> = emptyList(),
    val siteChecklist: List<IdeaChecklistRow> = emptyList(),
)

@Serializable
data class IdeaWhoAsks(
    val persona: String = "",
    val promptPatterns: List<String> = emptyList(),
)

@Serializable
data class IdeaCitation(
    val status: String = "not_measured",
    val snapshots: List<IdeaSnapshot> = emptyList(),
)

@Serializable
data class IdeaSnapshot(
    val hostname: String = "",
    val title: String? = null,
    val fetchStatus: String = "not_measured",
)

@Serializable
data class IdeaBet(
    val hypothesis: String = "",
)

@Serializable
data class IdeaChecklistRow(
    val id: String = "",
    val label: String = "",
    val status: String = "not_measured",
)

data class StudioSource(
    val id: String,
    val title: String,
    val content: String,
    val kind: String,
    val selected: Boolean,
    val addedAt: Long,
)

@Serializable
data class AudioOverviewTurn(
    val speaker: String = "Alex",
    val text: String = "",
)

@Serializable
data class AudioOverview(
    val title: String = "",
    val summary: String = "",
    val script: List<AudioOverviewTurn> = emptyList(),
)
