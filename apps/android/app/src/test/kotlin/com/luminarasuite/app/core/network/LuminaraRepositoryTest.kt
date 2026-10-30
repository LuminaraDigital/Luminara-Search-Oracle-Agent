package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.auth.InMemoryVaultStorage
import com.luminarasuite.app.core.database.AuditHistoryEntity
import com.luminarasuite.app.core.database.FindingEntity
import com.luminarasuite.app.core.database.LuminaraDao
import com.luminarasuite.app.core.model.AccountDeleteRequest
import com.luminarasuite.app.core.model.AccountDeleteResponse
import com.luminarasuite.app.core.model.AuditFinding
import com.luminarasuite.app.core.model.AuditHistoryEntry
import com.luminarasuite.app.core.model.AuditHistoryListResponse
import com.luminarasuite.app.core.model.AuditHistoryUpsertRequest
import com.luminarasuite.app.core.model.AuditHistoryUpsertResponse
import com.luminarasuite.app.core.model.AuthCredentialsRequest
import com.luminarasuite.app.core.model.AuthTokenResponse
import com.luminarasuite.app.core.model.BootResponse
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.model.CrawlerFilesResponse
import com.luminarasuite.app.core.model.CrawlerFilesSnapshot
import com.luminarasuite.app.core.model.FindingPatchRequest
import com.luminarasuite.app.core.model.FindingPatchResponse
import com.luminarasuite.app.core.model.FindingsBulkRequest
import com.luminarasuite.app.core.model.FindingsBulkResponse
import com.luminarasuite.app.core.model.FindingsListResponse
import com.luminarasuite.app.core.model.GatewayExecuteRequest
import com.luminarasuite.app.core.model.GatewayExecuteResponse
import com.luminarasuite.app.core.model.GroqChatRequest
import com.luminarasuite.app.core.model.GroqChatResponse
import com.luminarasuite.app.core.model.GroqChoice
import com.luminarasuite.app.core.model.GroqMessage
import com.luminarasuite.app.core.model.PrivacyExportResponse
import com.luminarasuite.app.core.model.ProbeCrawlData
import com.luminarasuite.app.core.model.ProbeCrawlResponse
import com.luminarasuite.app.core.model.QuotaStatus
import com.luminarasuite.app.core.model.ScoutRecheckRequest
import com.luminarasuite.app.core.model.ScoutRecheckResponse
import com.luminarasuite.app.core.model.TavilyResult
import com.luminarasuite.app.core.model.TavilySearchRequest
import com.luminarasuite.app.core.model.TavilySearchResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeLuminaraDao : LuminaraDao {
    private val historyState = MutableStateFlow<List<AuditHistoryEntity>>(emptyList())
    private val findingsState = MutableStateFlow<List<FindingEntity>>(emptyList())

    override fun observeAuditHistory(): Flow<List<AuditHistoryEntity>> = historyState

    override suspend fun upsertAuditHistory(entries: List<AuditHistoryEntity>) {
        val map = historyState.value.associateBy { it.id }.toMutableMap()
        entries.forEach { map[it.id] = it }
        historyState.value = map.values.sortedByDescending { it.measuredAt }
    }

    override fun observeFindings(): Flow<List<FindingEntity>> = findingsState

    override suspend fun upsertFindings(findings: List<FindingEntity>) {
        val map = findingsState.value.associateBy { it.id }.toMutableMap()
        findings.forEach { map[it.id] = it }
        findingsState.value = map.values.sortedByDescending { it.updatedAt }
    }

    override suspend fun deleteFindingsForDomain(domain: String) {
        findingsState.value = findingsState.value.filterNot { it.domain == domain }
    }

    override suspend fun updateFindingStatus(
        id: String,
        status: String,
        updatedAt: Long,
    ) {
        findingsState.value =
            findingsState.value.map {
                if (it.id == id) it.copy(status = status, updatedAt = updatedAt) else it
            }
    }

    override suspend fun clearAuditHistory() {
        historyState.value = emptyList()
    }

    override suspend fun clearFindings() {
        findingsState.value = emptyList()
    }
}

class FakeLuminaraApi : LuminaraApi {
    val queriedFindingDomains = mutableListOf<String?>()
    var lastPatchedFindingId: String? = null
    var lastPatchedFindingStatus: String? = null
    var remoteHistoryEntries: List<AuditHistoryEntry> = emptyList()
    var snapshotToReturn =
        CrawlerFilesSnapshot(
            llmsTxt = "",
            llmsHttpStatus = 404,
            robotsTxt = "User-agent: *\nAllow: /",
            robotsHttpStatus = 200,
            aiTxt = "",
            aiHttpStatus = 404,
        )

    override suspend fun probeCrawl(url: String): ProbeCrawlResponse =
        ProbeCrawlResponse(
            ok = true,
            host = "example.com",
            crawl = ProbeCrawlData(status = "measured", note = "Live crawl OK"),
        )

    override suspend fun fetchCrawlerFiles(url: String): CrawlerFilesResponse =
        CrawlerFilesResponse(ok = true, snapshot = snapshotToReturn)

    override suspend fun executeGateway(body: GatewayExecuteRequest): GatewayExecuteResponse =
        GatewayExecuteResponse(
            ok = true,
            targetDomain = body.targetDomain,
            verdict = "${body.targetDomain} allows AI crawlers but lacks /llms.txt.",
            oneMoveThisWeek = "Publish /llms.txt at your domain root.",
            healthScore = null,
            receiptIssued = true,
            receiptNote = "Live HTTP crawl receipt verified.",
        )

    override suspend fun recheckFix(body: ScoutRecheckRequest): ScoutRecheckResponse =
        ScoutRecheckResponse(
            ok = true,
            checkId = body.checkId,
            label = body.checkId,
            measured = true,
            passed = true,
            detail = "Live check passed.",
        )

    override suspend fun getAuditHistory(limit: Int): AuditHistoryListResponse =
        AuditHistoryListResponse(ok = true, entries = remoteHistoryEntries)

    override suspend fun upsertAuditHistory(body: AuditHistoryUpsertRequest): AuditHistoryUpsertResponse =
        AuditHistoryUpsertResponse(ok = true, entry = body.entry)

    override suspend fun getFindings(domain: String?): FindingsListResponse {
        queriedFindingDomains.add(domain)
        val findings =
            if (domain.isNullOrBlank()) {
                emptyList()
            } else {
                listOf(
                    AuditFinding(
                        id = "fnd_remote_$domain",
                        auditRunId = "run-1",
                        domain = domain,
                        stableKey = "crawler::llms_txt",
                        title = "Fix llms.txt present",
                        description = "Add /llms.txt",
                        status = "open",
                        createdAt = 100L,
                        updatedAt = 100L,
                    ),
                )
            }
        return FindingsListResponse(ok = true, findings = findings)
    }

    override suspend fun createFindingsBulk(body: FindingsBulkRequest): FindingsBulkResponse {
        val persisted =
            body.findings.mapIndexed { index, item ->
                AuditFinding(
                    id = "fnd_server_${index + 1}",
                    auditRunId = body.auditRunId.orEmpty(),
                    domain = body.domain,
                    stableKey = item.stableKey.orEmpty(),
                    category = item.category,
                    severity = item.severity,
                    title = item.title,
                    description = item.description,
                    status = item.status,
                    createdAt = 1730000000000L,
                    updatedAt = 1730000000000L,
                )
            }
        return FindingsBulkResponse(ok = true, findings = persisted)
    }

    override suspend fun updateFindingStatus(
        id: String,
        body: FindingPatchRequest,
    ): FindingPatchResponse {
        lastPatchedFindingId = id
        lastPatchedFindingStatus = body.status
        return FindingPatchResponse(ok = true)
    }

    override suspend fun signIn(body: AuthCredentialsRequest): AuthTokenResponse =
        AuthTokenResponse(
            ok = true,
            idToken = "jwt-token-123",
            refreshToken = "refresh-123",
            localId = "uid123",
            email = body.email,
        )

    override suspend fun signUp(body: AuthCredentialsRequest): AuthTokenResponse =
        AuthTokenResponse(
            ok = true,
            idToken = "jwt-token-new",
            refreshToken = "refresh-new",
            localId = "uidNew",
            email = body.email,
        )

    override suspend fun getAccountBoot(): BootResponse =
        BootResponse(
            ok = true,
            accountId = "fb:uid123",
            quota = QuotaStatus(ok = true, authenticated = true, plan = "free", limit = 3, remaining = 2),
        )

    override suspend fun deleteAccount(body: AccountDeleteRequest): AccountDeleteResponse =
        AccountDeleteResponse(ok = body.confirm == "DELETE", rows = 8, firebaseDeleted = true)

    override suspend fun requestDataExport(): PrivacyExportResponse =
        PrivacyExportResponse(ok = true, jobId = "exp-1", status = "ready", message = "Export ready.")

    override suspend fun searchTavily(
        providerKey: String?,
        body: TavilySearchRequest,
    ): TavilySearchResponse =
        TavilySearchResponse(
            answer = "Grounded summary",
            results =
            listOf(
                TavilyResult(
                    title = "LLM Crawl Guide",
                    url = "https://www.luminarasuite.com/methodology",
                    content = "Publish /llms.txt with canonical URLs.",
                ),
            ),
        )

    override suspend fun chatGroq(
        providerKey: String?,
        acceptFallback: String,
        body: GroqChatRequest,
    ): GroqChatResponse =
        GroqChatResponse(
            choices =
            listOf(
                GroqChoice(
                    message =
                    GroqMessage(
                        role = "assistant",
                        content =
                        "VERDICT: Publish /llms.txt \u2014 and allow GPTBot.\n" +
                            "NEXT_ACTION: Add H1 and canonical links to /llms.txt.",
                    ),
                ),
            ),
        )
}

class LuminaraRepositoryTest {
    @Test
    fun runInstantAudit_storesHistoryAndFindingsWithHonestNullHealthScore() =
        runTest {
            val dao = FakeLuminaraDao()
            val vault = InMemoryVaultStorage()
            val api = FakeLuminaraApi()
            val repo = DefaultLuminaraRepository(api = api, dao = dao, vault = vault, clockMs = { 1730000000000L })

            val result = repo.runInstantAudit("https://www.example.com")
            assertTrue(result.isSuccess)
            val report = result.getOrThrow()
            assertEquals("example.com", report.domain)
            assertNull(report.healthScore)

            val storedHistory = repo.auditHistoryFlow.first()
            assertEquals(1, storedHistory.size)
            assertNull(storedHistory.first().healthScore)

            val storedFindings = repo.findingsFlow.first()
            assertTrue(storedFindings.isNotEmpty())
        }

    @Test
    fun askOracle_requiresAuthOrByokAndScrubsEmDashes() =
        runTest {
            val dao = FakeLuminaraDao()
            val vault = InMemoryVaultStorage()
            val api = FakeLuminaraApi()
            val repo = DefaultLuminaraRepository(api = api, dao = dao, vault = vault)

            val unauthedResult = repo.askOracle("How do I fix llms.txt?")
            assertTrue(unauthedResult.isFailure)

            repo.saveByokKeys(ByokKeyBag(groqKey = "gsk_test_key"))
            val groqOnlyResult = repo.askOracle("How do I fix llms.txt?")
            assertTrue(groqOnlyResult.isSuccess)
            assertEquals("not_measured", groqOnlyResult.getOrThrow().measurementStatus)

            repo.saveByokKeys(ByokKeyBag(groqKey = "gsk_test_key", tavilyKey = "tvly_test_key"))
            val byokResult = repo.askOracle("How do I fix llms.txt?")
            assertTrue(byokResult.isSuccess)
            val turn = byokResult.getOrThrow()
            assertFalse(turn.verdict.contains("\u2014"))
            assertEquals("Groq LPU (BYOK)", turn.modelLabel)
            assertEquals("measured", turn.measurementStatus)
        }

    @Test
    fun syncAuditToCloud_replacesLocalFindingIdsWithServerIdsAndUpdatesStatus() =
        runTest {
            val dao = FakeLuminaraDao()
            val vault = InMemoryVaultStorage()
            val api = FakeLuminaraApi()
            val repo = DefaultLuminaraRepository(api = api, dao = dao, vault = vault)

            repo.signIn("operator@luminarasuite.com", "password123")
            repo.runInstantAudit("example.com")

            val findings = repo.findingsFlow.first()
            assertTrue(findings.all { it.id.startsWith("fnd_server_") })

            val targetId = findings.first().id
            repo.updateFindingStatus(targetId, "in_progress")
            assertEquals(targetId, api.lastPatchedFindingId)
            assertEquals("in_progress", api.lastPatchedFindingStatus)
        }

    @Test
    fun recheckSingleCheck_evaluatesLiveCrawlerFilesForLlmsTxtAndDelegatesSchemaCheck() =
        runTest {
            val dao = FakeLuminaraDao()
            val vault = InMemoryVaultStorage()
            val api = FakeLuminaraApi()
            api.snapshotToReturn =
                CrawlerFilesSnapshot(
                    llmsTxt = "# Brand\n> Summary\n- [Docs](https://example.com/docs)",
                    llmsHttpStatus = 200,
                    robotsTxt = "User-agent: *\nAllow: /",
                    robotsHttpStatus = 200,
                    aiTxt = "User-agent: *\nAllow: /",
                    aiHttpStatus = 200,
                )
            val repo = DefaultLuminaraRepository(api = api, dao = dao, vault = vault)

            val crawlerRecheck = repo.recheckSingleCheck("example.com", "llms_txt").getOrThrow()
            assertEquals(true, crawlerRecheck.passed)
            assertTrue(crawlerRecheck.measured)

            val schemaRecheck = repo.recheckSingleCheck("example.com", "schema").getOrThrow()
            assertEquals("schema", schemaRecheck.checkId)
            assertEquals(true, schemaRecheck.passed)
        }

    @Test
    fun refreshDashboard_queriesFindingsPerAuditDomain() =
        runTest {
            val dao = FakeLuminaraDao()
            val vault = InMemoryVaultStorage()
            val api = FakeLuminaraApi()
            api.remoteHistoryEntries =
                listOf(
                    AuditHistoryEntry(
                        id = "audit-1",
                        domain = "luminarasuite.com",
                        measuredAt = 1000L,
                        title = "AEO audit",
                        summary = "Summary",
                    ),
                )
            val repo = DefaultLuminaraRepository(api = api, dao = dao, vault = vault)
            repo.signIn("operator@luminarasuite.com", "password123")
            api.queriedFindingDomains.clear()

            repo.refreshDashboard()
            assertEquals(listOf("luminarasuite.com"), api.queriedFindingDomains)
        }

    @Test
    fun signInAndDeleteAccount_wipesLocalDatabaseAndVaultSession() =
        runTest {
            val dao = FakeLuminaraDao()
            val vault = InMemoryVaultStorage()
            val api = FakeLuminaraApi()
            val repo = DefaultLuminaraRepository(api = api, dao = dao, vault = vault)

            val signInRes = repo.signIn("operator@luminarasuite.com", "password123")
            assertTrue(signInRes.isSuccess)
            assertTrue(vault.getSnapshot().isSignedIn)

            repo.runInstantAudit("luminarasuite.com")
            assertEquals(1, repo.auditHistoryFlow.first().size)

            val badDelete = repo.deleteAccountPermanently("wrong")
            assertTrue(badDelete.isFailure)

            val goodDelete = repo.deleteAccountPermanently("DELETE")
            assertTrue(goodDelete.isSuccess)
            assertFalse(vault.getSnapshot().isSignedIn)
            assertTrue(repo.auditHistoryFlow.first().isEmpty())
            assertTrue(repo.findingsFlow.first().isEmpty())
        }
}
