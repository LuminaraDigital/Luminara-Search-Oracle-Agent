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
import com.luminarasuite.app.core.model.GatewayExecuteRequest
import com.luminarasuite.app.core.model.GroqChatRequest
import com.luminarasuite.app.core.model.GroqMessage
import com.luminarasuite.app.core.model.OracleTurn
import com.luminarasuite.app.core.model.QuotaStatus
import com.luminarasuite.app.core.model.ScoutRecheckRequest
import com.luminarasuite.app.core.model.ScoutRecheckResponse
import com.luminarasuite.app.core.model.TavilyResult
import com.luminarasuite.app.core.model.TavilySearchRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

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
    override val vaultFlow: Flow<VaultSnapshot> = vault.snapshotFlow

    override val auditHistoryFlow: Flow<List<AuditHistoryEntry>> =
        dao.observeAuditHistory().map { list -> list.map { it.toDomain() } }

    override val findingsFlow: Flow<List<AuditFinding>> =
        dao.observeFindings().map { list -> list.map { it.toDomain() } }

    override suspend fun runInstantAudit(rawDomain: String): Result<InstantAuditReport> =
        runCatching {
            val domain =
                EvaluationEngine.normalizeDomain(rawDomain)
                    ?: throw IllegalArgumentException("Enter a valid domain such as example.com.")
            val targetUrl = "https://$domain"

            val probe = runCatching { api.probeCrawl(targetUrl) }.getOrNull()
            val files = api.fetchCrawlerFiles(targetUrl)
            val evaluation = EvaluationEngine.evaluateCrawlerFiles(domain, files.snapshot)
            val vaultSnap = vault.getSnapshot()
            val gateway =
                if (vaultSnap.isSignedIn) {
                    runCatching {
                        api.executeGateway(GatewayExecuteRequest(targetDomain = domain, focus = "AEO"))
                    }.getOrNull()
                } else {
                    null
                }

            val verdict =
                gateway?.verdict?.takeIf { it.isNotBlank() }
                    ?: buildDeterministicVerdict(domain, evaluation)
            val oneMove =
                gateway?.oneMoveThisWeek?.takeIf { it.isNotBlank() }
                    ?: buildDeterministicOneMove(domain, evaluation)

            persistAuditArtifacts(
                domain = domain,
                evaluation = evaluation,
                verdict = verdict,
                oneMove = oneMove,
                healthScore = gateway?.healthScore,
                isSignedIn = vaultSnap.isSignedIn,
            )

            InstantAuditReport(
                domain = domain,
                probeNote = probe?.crawl?.note?.takeIf { it.isNotBlank() } ?: "Live HTTP crawl completed.",
                evaluation = evaluation,
                verdict = verdict,
                oneMoveThisWeek = oneMove,
                healthScore = gateway?.healthScore,
                receiptNote =
                gateway?.receiptNote?.takeIf { it.isNotBlank() }
                    ?: "Deterministic check of /$domain/robots.txt, /llms.txt, and /ai.txt.",
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
        runCatching { api.upsertAuditHistory(AuditHistoryUpsertRequest(entry = historyEntry)) }
        if (findings.isEmpty()) return
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
        }
    }

    override suspend fun recheckSingleCheck(
        domain: String,
        checkId: String,
    ): Result<ScoutRecheckResponse> =
        runCatching {
            val normalized =
                EvaluationEngine.normalizeDomain(domain)
                    ?: throw IllegalArgumentException("Enter a valid domain.")
            api.recheckFix(ScoutRecheckRequest(recheck = true, domain = normalized, checkId = checkId))
        }

    override suspend fun askOracle(question: String): Result<OracleTurn> =
        runCatching {
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
    ): List<TavilyResult> =
        runCatching {
            api.searchTavily(
                providerKey = tavilyKey,
                body = TavilySearchRequest(query = query),
            ).results
        }.getOrDefault(emptyList())

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
        return OracleTurn(
            id = "turn-${clockMs()}",
            question = question,
            verdict = verdictLine,
            nextAction = actionLine,
            sources = sources,
            modelLabel = if (groqKey != null) "Groq LPU (BYOK)" else "Groq LPU (Hosted)",
            measurementStatus = if (sources.isNotEmpty()) "measured" else "not_measured",
            timestampMs = clockMs(),
        )
    }

    override suspend fun reportOracleTurn(turnId: String) {
        vault.reportAiTurn(turnId)
    }

    override suspend fun refreshDashboard(): Result<Unit> =
        runCatching {
            if (!vault.getSnapshot().isSignedIn) return@runCatching
            val remoteHistory = api.getAuditHistory()
            if (remoteHistory.entries.isNotEmpty()) {
                dao.upsertAuditHistory(remoteHistory.entries.map { it.toEntity() })
            }
            val remoteFindings = api.getFindings()
            if (remoteFindings.findings.isNotEmpty()) {
                dao.upsertFindings(remoteFindings.findings.map { it.toEntity() })
            }
        }

    override suspend fun updateFindingStatus(
        findingId: String,
        newStatus: String,
    ): Result<Unit> =
        runCatching {
            dao.updateFindingStatus(findingId, newStatus, clockMs())
            if (vault.getSnapshot().isSignedIn) {
                runCatching { api.updateFindingStatus(findingId, FindingPatchRequest(status = newStatus)) }
            }
        }

    override suspend fun signIn(
        email: String,
        password: String,
    ): Result<QuotaStatus?> =
        runCatching {
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
        runCatching {
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
        runCatching {
            if (!vault.getSnapshot().isSignedIn) return@runCatching null
            val boot = api.getAccountBoot()
            runCatching { refreshDashboard() }
            boot.quota
        }

    override suspend fun saveByokKeys(bag: ByokKeyBag) {
        vault.saveByokKeys(bag)
    }

    override suspend fun signOut() {
        vault.clearSession()
    }

    override suspend fun exportAccountData(): Result<String> =
        runCatching {
            require(vault.getSnapshot().isSignedIn) { "Sign in to request an account data export." }
            val res = api.requestDataExport()
            res.message.ifBlank { "Data export ready (job ${res.jobId})." }
        }

    override suspend fun deleteAccountPermanently(confirmText: String): Result<Unit> =
        runCatching {
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
