package com.luminarasuite.app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

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
    val runId: String = "",
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
    val llmsHttpStatus: Int = 0,
    val robotsHttpStatus: Int = 0,
    val aiHttpStatus: Int = 0,
    val passCount: Int = 0,
    val failCount: Int = 0,
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
    val passed: Boolean = false,
    val detail: String = "",
    val url: String = "",
    val httpStatus: Int = 0,
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
    val content: String,
)

@Serializable
data class GroqChatRequest(
    val model: String = "llama-3.3-70b-versatile",
    val messages: List<GroqMessage>,
    val temperature: Double = 0.2,
    @SerialName("max_tokens")
    val maxTokens: Int = 1024,
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
