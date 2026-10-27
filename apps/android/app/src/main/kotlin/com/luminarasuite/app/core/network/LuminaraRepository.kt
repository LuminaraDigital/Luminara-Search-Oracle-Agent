package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.auth.VaultSnapshot
import com.luminarasuite.app.core.auth.VaultStorage
import com.luminarasuite.app.core.database.LuminaraDao
import com.luminarasuite.app.core.database.toEntity
import com.luminarasuite.app.core.model.AccountDeleteRequest
import com.luminarasuite.app.core.model.AuditFinding
import com.luminarasuite.app.core.model.AuditHistoryEntry
import com.luminarasuite.app.core.model.AuditHistoryUpsertRequest
import com.luminarasuite.app.core.model.AuthCredentialsRequest
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.model.CrawlerEvaluationResult
import com.luminarasuite.app.core.model.EvaluationEngine
import com.luminarasuite.app.core.model.FindingPatchRequest
import com.luminarasuite.app.core.model.FindingsBulkItem
import com.luminarasuite.app.core.model.FindingsBulkRequest
import com.luminarasuite.app.core.model.GroqChatRequest
import com.luminarasuite.app.core.model.GroqMessage
import com.luminarasuite.app.core.model.OracleTurn
import com.luminarasuite.app.core.model.QuotaStatus
import com.luminarasuite.app.core.model.ScoutRecheckRequest
import com.luminarasuite.app.core.model.ScoutRecheckResponse
import com.luminarasuite.app.core.model.TavilyResult
import com.luminarasuite.app.core.model.TavilySearchRequest
import com.luminarasuite.app.core.model.WorkerErrorPayload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import retrofit2.HttpException

data class InstantAuditReport(
    val domain: String,
    val probeNote: String,
    val evaluation: CrawlerEvaluationResult,
    val verdict: String,
    val oneMoveThisWeek: String,
    val healthScore: Int?,
    val receiptNote: String,
)

interface LuminaraRepository {
    val vaultFlow: Flow<VaultSnapshot>
    val auditHistoryFlow: Flow<List<AuditHistoryEntry>>
    val findingsFlow: Flow<List<AuditFinding>>

    suspend fun runInstantAudit(rawDomain: String): Result<InstantAuditReport>

    suspend fun recheckSingleCheck(
        domain: String,
        checkId: String,
    ): Result<ScoutRecheckResponse>

    suspend fun askOracle(question: String): Result<OracleTurn>

    suspend fun reportOracleTurn(turnId: String)

    suspend fun refreshDashboard(): Result<Unit>

    suspend fun updateFindingStatus(
        findingId: String,
        newStatus: String,
    ): Result<Unit>

    suspend fun signIn(
        email: String,
        password: String,
    ): Result<QuotaStatus?>

    suspend fun signUp(
        email: String,
        password: String,
    ): Result<QuotaStatus?>

    suspend fun refreshQuota(): Result<QuotaStatus?>

    suspend fun saveByokKeys(bag: ByokKeyBag)

    suspend fun signOut()

    suspend fun exportAccountData(): Result<String>

    suspend fun deleteAccountPermanently(confirmText: String): Result<Unit>
}

class DefaultLuminaraRepository(
    private val api: LuminaraApi,
    private val dao: LuminaraDao,
    private val vault: VaultStorage,
    private val clockMs: () -> Long = { System.currentTimeMillis() },
) : LuminaraRepository {
    companion object {
        private val CRAWLER_CHECK_IDS =
            setOf("llms_txt", "llms_structure", "ai_bot_directives", "cite_paths", "ai_txt")
        private val ERROR_JSON = Json { ignoreUnknownKeys = true }
    }

    override val vaultFlow: Flow<VaultSnapshot> = vault.snapshotFlow

    override val auditHistoryFlow: Flow<List<AuditHistoryEntry>> =
        dao.observeAuditHistory().map { list -> list.map { it.toDomain() } }

    override val findingsFlow: Flow<List<AuditFinding>> =
        dao.observeFindings().map { list -> list.map { it.toDomain() } }

    override suspend fun runInstantAudit(rawDomain: String): Result<InstantAuditReport> =
        safeCall {
            val domain =
                EvaluationEngine.normalizeDomain(rawDomain)
                    ?: throw IllegalArgumentException("Enter a valid domain such as example.com.")
            val targetUrl = "https://$domain"

            val probe = runCatching { api.probeCrawl(targetUrl) }.rethrowCancellation().getOrNull()
            val files = api.fetchCrawlerFiles(targetUrl)
            val evaluation = EvaluationEngine.evaluateCrawlerFiles(domain, files.snapshot)
            val vaultSnap = vault.getSnapshot()

            val verdict = buildDeterministicVerdict(domain, evaluation)
            val oneMove = buildDeterministicOneMove(domain, evaluation)

            persistAuditArtifacts(
                domain = domain,
                evaluation = evaluation,
                verdict = verdict,
                oneMove = oneMove,
                healthScore = null,
                isSignedIn = vaultSnap.isSignedIn,
            )

            InstantAuditReport(
                domain = domain,
                probeNote = probe?.crawl?.note?.takeIf { it.isNotBlank() } ?: "Live HTTP crawl completed.",
                evaluation = evaluation,
                verdict = verdict,
                oneMoveThisWeek = oneMove,
                healthScore = null,
                receiptNote = "Deterministic check of /$domain/robots.txt, /llms.txt, and /ai.txt.",
            )
        }

    private suspend fun persistAuditArtifacts(
        domain: String,
        evaluation: CrawlerEvaluationResult,
        verdict: String,
        oneMove: String,
        healthScore: Int?,
        isSignedIn: Boolean,
    ) {
        val now = clockMs()
        val gapCount = evaluation.failCount.takeIf { evaluation.measurementStatus == "measured" }
        val historyEntry =
            AuditHistoryEntry(
                id = "audit-$now-${domain.hashCode().toUInt().toString(16)}",
                domain = domain,
                focus = "AEO",
                measuredAt = now,
                healthScore = healthScore,
                citationRatePercent = null,
                schemaGapCount = gapCount,
                topCompetitor = null,
                title = "AEO audit · $domain",
                summary = verdict,
                reportExcerpt = "$verdict\n\nNext action: $oneMove",
            )
        dao.upsertAuditHistory(listOf(historyEntry.toEntity()))

        val newFindings = buildFindingsForEvaluation(domain, historyEntry.id, evaluation, now)
        if (newFindings.isNotEmpty()) {
            dao.upsertFindings(newFindings.map { it.toEntity() })
        }

        if (isSignedIn) {
            syncAuditToCloud(domain, historyEntry, newFindings)
        }
    }

    private fun buildFindingsForEvaluation(
        domain: String,
        auditRunId: String,
        evaluation: CrawlerEvaluationResult,
        timestampMs: Long,
    ): List<AuditFinding> =
        evaluation.checks
            .filter { it.status == "fail" }
            .map { check ->
                val isHighPriority = check.id == "llms_txt" || check.id == "ai_bot_directives"
                AuditFinding(
                    id = "fnd_${domain}_${check.id}",
                    auditRunId = auditRunId,
                    domain = domain,
                    stableKey = "crawler::${check.id}",
                    category = "technical",
                    severity = if (isHighPriority) "high" else "medium",
                    title = "Fix ${check.label}",
                    description = check.detail,
                    status = "open",
                    createdAt = timestampMs,
                    updatedAt = timestampMs,
                )
            }

    private suspend fun syncAuditToCloud(
        domain: String,
        historyEntry: AuditHistoryEntry,
        findings: List<AuditFinding>,
    ) {
        runCatching {
            api.upsertAuditHistory(AuditHistoryUpsertRequest(entry = historyEntry))
        }.rethrowCancellation()
        if (findings.isEmpty()) return
        val bulkResponse =
            runCatching {
                val items =
                    findings.map {
                        FindingsBulkItem(
                            id = it.id,
                            stableKey = it.stableKey,
                            category = it.category,
                            severity = it.severity,
                            title = it.title,
                            description = it.description,
                            status = it.status,
                        )
                    }
                api.createFindingsBulk(
                    FindingsBulkRequest(
                        domain = domain,
                        auditRunId = historyEntry.id,
                        findings = items,
                    ),
                )
            }.rethrowCancellation().getOrNull()

        if (bulkResponse != null && bulkResponse.findings.isNotEmpty()) {
            dao.deleteFindingsForDomain(domain)
            dao.upsertFindings(bulkResponse.findings.map { it.toEntity() })
        }
    }

    override suspend fun recheckSingleCheck(
        domain: String,
        checkId: String,
    ): Result<ScoutRecheckResponse> =
        safeCall {
            val normalized =
                EvaluationEngine.normalizeDomain(domain)
                    ?: throw IllegalArgumentException("Enter a valid domain.")
            if (checkId in CRAWLER_CHECK_IDS) {
                val files = api.fetchCrawlerFiles("https://$normalized")
                val evaluation = EvaluationEngine.evaluateCrawlerFiles(normalized, files.snapshot)
                val check =
                    evaluation.checks.firstOrNull { it.id == checkId }
                        ?: throw IllegalArgumentException("Unknown check ID: $checkId")
                val passed =
                    when (check.status) {
                        "pass" -> true
                        "fail" -> false
                        else -> null
                    }
                ScoutRecheckResponse(
                    ok = true,
                    checkId = check.id,
                    label = check.label,
                    measured = check.status != "not_measured",
                    passed = passed,
                    detail = check.detail,
                )
            } else {
                api.recheckFix(ScoutRecheckRequest(recheck = true, domain = normalized, checkId = checkId))
            }
        }

    override suspend fun askOracle(question: String): Result<OracleTurn> =
        safeCall {
            val trimmed = question.trim()
            require(trimmed.isNotEmpty()) { "Enter a question or domain for the Oracle." }

            val snap = vault.getSnapshot()
            val groqKey = snap.byokKeys.groqKey.takeIf { it.isNotBlank() }
            val tavilyKey = snap.byokKeys.tavilyKey.takeIf { it.isNotBlank() }
            if (!snap.isSignedIn && groqKey == null) {
                throw IllegalStateException("Sign in to use hosted AI, or add your Groq API key in Settings.")
            }

            val searchResults = fetchOracleEvidence(trimmed, tavilyKey)
            val response =
                api.chatGroq(
                    providerKey = groqKey,
                    body = buildOracleChatRequest(trimmed, searchResults),
                )
            parseOracleTurn(trimmed, response.choices.firstOrNull()?.message?.content.orEmpty(), searchResults, groqKey)
        }

    private suspend fun fetchOracleEvidence(
        query: String,
        tavilyKey: String?,
    ): List<TavilyResult> {
        if (tavilyKey == null) return emptyList()
        return runCatching {
            api.searchTavily(
                providerKey = tavilyKey,
                body = TavilySearchRequest(query = query),
            ).results
        }.rethrowCancellation().getOrDefault(emptyList())
    }

    private fun buildOracleChatRequest(
        question: String,
        sources: List<TavilyResult>,
    ): GroqChatRequest {
        val evidenceBlock =
            if (sources.isEmpty()) {
                "Live search evidence: not_measured (no search results returned)."
            } else {
                sources.mapIndexed { idx, item ->
                    "[${idx + 1}] ${item.title} (${item.url}): ${item.content.take(240)}"
                }.joinToString("\n")
            }
        val systemPrompt =
            "You are Luminara Search Oracle, an evidence-bound SEO, AEO, and GEO advisor.\n" +
                "1. Never invent SEO metrics or citation percentages. Use not_measured when data is missing.\n" +
                "2. Never use the em dash character anywhere. Use a hyphen, colon, or period.\n" +
                "3. Format your response as two lines:\n" +
                "VERDICT: <concise 1-2 sentence verdict>\n" +
                "NEXT_ACTION: <one concrete action to execute this week>"
        return GroqChatRequest(
            messages =
            listOf(
                GroqMessage(role = "system", content = systemPrompt),
                GroqMessage(role = "user", content = "Question: $question\n\n$evidenceBlock"),
            ),
        )
    }

    private fun parseOracleTurn(
        question: String,
        rawContent: String,
        sources: List<TavilyResult>,
        groqKey: String?,
    ): OracleTurn {
        val clean = rawContent.replace("\u2014", "-")
        val verdictLine =
            clean.lineSequence()
                .firstOrNull { it.startsWith("VERDICT:", ignoreCase = true) }
                ?.substringAfter(":")
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?: clean.lineSequence().firstOrNull { it.isNotBlank() }?.trim()
                ?: "Evidence check completed."
        val actionLine =
            clean.lineSequence()
                .firstOrNull { it.startsWith("NEXT_ACTION:", ignoreCase = true) }
                ?.substringAfter(":")
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?: "Run Instant Audit on your target domain and publish /llms.txt with canonical links."
        val now = clockMs()
        return OracleTurn(
            id = "turn-$now-${question.hashCode().toUInt().toString(16)}",
            question = question,
            verdict = verdictLine,
            nextAction = actionLine,
            sources = sources,
            modelLabel = if (groqKey != null) "Groq LPU (BYOK)" else "Groq LPU (Hosted)",
            measurementStatus = if (sources.isNotEmpty()) "measured" else "not_measured",
            timestampMs = now,
        )
    }

    override suspend fun reportOracleTurn(turnId: String) {
        vault.reportAiTurn(turnId)
    }

    override suspend fun refreshDashboard(): Result<Unit> =
        safeCall {
            if (!vault.getSnapshot().isSignedIn) return@safeCall
            val remoteHistory = api.getAuditHistory()
            if (remoteHistory.entries.isNotEmpty()) {
                dao.upsertAuditHistory(remoteHistory.entries.map { it.toEntity() })
            }
            val localDomains = auditHistoryFlow.first().map { it.domain }
            val domains =
                (remoteHistory.entries.map { it.domain } + localDomains)
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }
                    .distinct()
                    .take(5)
            for (domain in domains) {
                val remoteFindings =
                    runCatching { api.getFindings(domain = domain) }
                        .rethrowCancellation()
                        .getOrNull()
                if (remoteFindings != null && remoteFindings.findings.isNotEmpty()) {
                    dao.upsertFindings(remoteFindings.findings.map { it.toEntity() })
                }
            }
        }

    override suspend fun updateFindingStatus(
        findingId: String,
        newStatus: String,
    ): Result<Unit> =
        safeCall {
            dao.updateFindingStatus(findingId, newStatus, clockMs())
            if (vault.getSnapshot().isSignedIn) {
                runCatching {
                    api.updateFindingStatus(findingId, FindingPatchRequest(status = newStatus))
                }.rethrowCancellation()
            }
        }

    override suspend fun signIn(
        email: String,
        password: String,
    ): Result<QuotaStatus?> =
        safeCall {
            val cleanEmail = email.trim()
            require(cleanEmail.contains('@') && password.length >= 6) {
                "Enter a valid email address and password (6+ characters)."
            }
            val res = api.signIn(AuthCredentialsRequest(email = cleanEmail, password = password))
            if (!res.ok || res.idToken.isBlank()) {
                throw IllegalStateException(res.error ?: "Sign-in failed. Check your credentials.")
            }
            vault.saveSession(
                idToken = res.idToken,
                refreshToken = res.refreshToken,
                email = res.email.ifBlank { cleanEmail },
                accountId = "fb:${res.localId}",
            )
            refreshQuota().getOrNull()
        }

    override suspend fun signUp(
        email: String,
        password: String,
    ): Result<QuotaStatus?> =
        safeCall {
            val cleanEmail = email.trim()
            require(cleanEmail.contains('@') && password.length >= 8) {
                "Enter a valid email and a password with at least 8 characters."
            }
            val res = api.signUp(AuthCredentialsRequest(email = cleanEmail, password = password))
            if (!res.ok || res.idToken.isBlank()) {
                throw IllegalStateException(res.error ?: "Account creation failed.")
            }
            vault.saveSession(
                idToken = res.idToken,
                refreshToken = res.refreshToken,
                email = res.email.ifBlank { cleanEmail },
                accountId = "fb:${res.localId}",
            )
            refreshQuota().getOrNull()
        }

    override suspend fun refreshQuota(): Result<QuotaStatus?> =
        safeCall {
            if (!vault.getSnapshot().isSignedIn) return@safeCall null
            val boot = api.getAccountBoot()
            runCatching { refreshDashboard() }.rethrowCancellation()
            boot.quota
        }

    override suspend fun saveByokKeys(bag: ByokKeyBag) {
        vault.saveByokKeys(bag)
    }

    override suspend fun signOut() {
        vault.clearSession()
    }

    override suspend fun exportAccountData(): Result<String> =
        safeCall {
            require(vault.getSnapshot().isSignedIn) { "Sign in to request an account data export." }
            val res = api.requestDataExport()
            res.message.ifBlank { "Data export ready (job ${res.jobId})." }
        }

    override suspend fun deleteAccountPermanently(confirmText: String): Result<Unit> =
        safeCall {
            require(confirmText.trim() == "DELETE") {
                "Type DELETE in uppercase to confirm permanent account erasure."
            }
            val snap = vault.getSnapshot()
            require(snap.isSignedIn) { "You are not signed in." }
            val res =
                api.deleteAccount(
                    AccountDeleteRequest(
                        confirm = "DELETE",
                        idToken = snap.idToken,
                    ),
                )
            if (!res.ok) {
                throw IllegalStateException(res.error ?: "Account deletion failed. Sign in again and retry.")
            }
            dao.clearAuditHistory()
            dao.clearFindings()
            vault.clearSession()
        }

    private inline fun <T> safeCall(block: () -> T): Result<T> =
        runCatching(block)
            .rethrowCancellation()
            .fold(
                onSuccess = { Result.success(it) },
                onFailure = { Result.failure(unwrapWorkerError(it)) },
            )

    private inline fun <T> Result<T>.rethrowCancellation(): Result<T> =
        onFailure { if (it is CancellationException) throw it }

    private fun unwrapWorkerError(err: Throwable): Throwable {
        if (err is HttpException) {
            val rawBody = runCatching { err.response()?.errorBody()?.string() }.getOrNull().orEmpty()
            if (rawBody.isNotBlank()) {
                val parsed = runCatching { ERROR_JSON.decodeFromString<WorkerErrorPayload>(rawBody) }.getOrNull()
                val message = parsed?.error?.takeIf { it.isNotBlank() }
                if (message != null) {
                    return IllegalStateException(message)
                }
            }
        }
        return err
    }

    private fun buildDeterministicVerdict(
        domain: String,
        eval: CrawlerEvaluationResult,
    ): String {
        if (eval.measurementStatus != "measured") {
            return "Live crawl for $domain is not_measured. Verify that https://$domain is publicly reachable."
        }
        return if (eval.failCount == 0) {
            "$domain passes all ${eval.passCount} AI crawler and llms.txt readiness checks."
        } else {
            "$domain passed ${eval.passCount} of ${eval.checks.size} checks (${eval.failCount} action item(s) open)."
        }
    }

    private fun buildDeterministicOneMove(
        domain: String,
        eval: CrawlerEvaluationResult,
    ): String {
        val firstFailed =
            eval.checks.firstOrNull { it.status == "fail" }
                ?: return "Maintain /$domain/llms.txt as new pages ship."
        return "${firstFailed.label}: ${firstFailed.detail}"
    }
}
