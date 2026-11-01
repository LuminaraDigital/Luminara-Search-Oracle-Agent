package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.auth.InMemoryVaultStorage
import com.luminarasuite.app.core.auth.VaultSnapshot
import com.luminarasuite.app.core.database.AuditHistoryEntity
import com.luminarasuite.app.core.database.FindingEntity
import com.luminarasuite.app.core.database.LuminaraDao
import com.luminarasuite.app.core.database.StudioSourceEntity
import com.luminarasuite.app.core.model.AccountDeleteRequest
import com.luminarasuite.app.core.model.AccountDeleteResponse
import com.luminarasuite.app.core.model.AppointmentDecisionRequest
import com.luminarasuite.app.core.model.AuditFinding
import com.luminarasuite.app.core.model.AuditHistoryEntry
import com.luminarasuite.app.core.model.AuditHistoryListResponse
import com.luminarasuite.app.core.model.AuditHistoryUpsertRequest
import com.luminarasuite.app.core.model.AuditHistoryUpsertResponse
import com.luminarasuite.app.core.model.AuditRunRequest
import com.luminarasuite.app.core.model.AuditRunResponse
import com.luminarasuite.app.core.model.AuthCredentialsRequest
import com.luminarasuite.app.core.model.AuthTokenResponse
import com.luminarasuite.app.core.model.BootResponse
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.model.CrawlerFilesResponse
import com.luminarasuite.app.core.model.CrawlerFilesSnapshot
import com.luminarasuite.app.core.model.EnquiryCreateRequest
import com.luminarasuite.app.core.model.EnquiryDeskResponse
import com.luminarasuite.app.core.model.EnquiryRecord
import com.luminarasuite.app.core.model.EnquiryTakeoverRequest
import com.luminarasuite.app.core.model.EnquiryTurnRequest
import com.luminarasuite.app.core.model.FindingPatchRequest
import com.luminarasuite.app.core.model.FindingPatchResponse
import com.luminarasuite.app.core.model.FindingsBulkRequest
import com.luminarasuite.app.core.model.FindingsBulkResponse
import com.luminarasuite.app.core.model.FindingsListResponse
import com.luminarasuite.app.core.model.FirecrawlMapRequest
import com.luminarasuite.app.core.model.FirecrawlMapResponse
import com.luminarasuite.app.core.model.FirecrawlPage
import com.luminarasuite.app.core.model.FirecrawlScrapeRequest
import com.luminarasuite.app.core.model.FirecrawlScrapeResponse
import com.luminarasuite.app.core.model.GatewayExecuteRequest
import com.luminarasuite.app.core.model.GatewayExecuteResponse
import com.luminarasuite.app.core.model.GoogleSignInRequest
import com.luminarasuite.app.core.model.GroqChatRequest
import com.luminarasuite.app.core.model.GroqChatResponse
import com.luminarasuite.app.core.model.GroqChoice
import com.luminarasuite.app.core.model.GroqMessage
import com.luminarasuite.app.core.model.HostedEntitlement
import com.luminarasuite.app.core.model.IdeaCard
import com.luminarasuite.app.core.model.IdeaCreateRequest
import com.luminarasuite.app.core.model.IdeaCreateResponse
import com.luminarasuite.app.core.model.IdeaDetailResponse
import com.luminarasuite.app.core.model.IdeaListResponse
import com.luminarasuite.app.core.model.PrivacyExportResponse
import com.luminarasuite.app.core.model.ProbeCrawlData
import com.luminarasuite.app.core.model.ProbeCrawlResponse
import com.luminarasuite.app.core.model.QuotaStatus
import com.luminarasuite.app.core.model.ScoutRecheckRequest
import com.luminarasuite.app.core.model.ScoutRecheckResponse
import com.luminarasuite.app.core.model.ShareCreateRequest
import com.luminarasuite.app.core.model.ShareCreateResponse
import com.luminarasuite.app.core.model.SharedReportBody
import com.luminarasuite.app.core.model.SharedReportResponse
import com.luminarasuite.app.core.model.SharedTeaserBody
import com.luminarasuite.app.core.model.SharedTeaserResponse
import com.luminarasuite.app.core.model.TavilyResult
import com.luminarasuite.app.core.model.TavilySearchRequest
import com.luminarasuite.app.core.model.TavilySearchResponse
import com.luminarasuite.app.core.model.WorkspacePutRequest
import com.luminarasuite.app.core.model.WorkspacePutResponse
import com.luminarasuite.app.core.model.WorkspaceResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

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

    private val studioState = MutableStateFlow<List<StudioSourceEntity>>(emptyList())

    override fun observeStudioSources(): Flow<List<StudioSourceEntity>> = studioState

    override suspend fun upsertStudioSource(source: StudioSourceEntity) {
        studioState.value = listOf(source) + studioState.value.filter { it.id != source.id }
    }

    override suspend fun setStudioSourceSelected(
        id: String,
        selected: Boolean,
    ) {
        studioState.value = studioState.value.map { if (it.id == id) it.copy(selected = selected) else it }
    }

    override suspend fun deleteStudioSource(id: String) {
        studioState.value = studioState.value.filter { it.id != id }
    }

    override suspend fun clearStudioSources() {
        studioState.value = emptyList()
    }

    override suspend fun clearFindings() {
        findingsState.value = emptyList()
    }
}

class FakeLuminaraApi : LuminaraApi {
    val queriedFindingDomains = mutableListOf<String?>()
    var chatReply: String? = null
    var chatFailure: Exception? = null
    var filesFailure: Exception? = null
    var lastChat: GroqChatRequest? = null
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

    override suspend fun fetchCrawlerFiles(url: String): CrawlerFilesResponse {
        filesFailure?.let { throw it }
        return CrawlerFilesResponse(ok = true, snapshot = snapshotToReturn)
    }

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

    var workspace = WorkspaceResponse(ok = true, updatedAt = 5L)
    var conflictsLeft = 0
    var lastWorkspacePut: WorkspacePutRequest? = null
    var enquiryTurns = mutableListOf<Pair<String, EnquiryTurnRequest>>()

    override suspend fun signInWithGoogle(body: GoogleSignInRequest): AuthTokenResponse =
        AuthTokenResponse(ok = true, idToken = "id", refreshToken = "r", localId = "g1", email = "g@example.com")

    override suspend fun getSharedReport(
        token: String,
        password: String?,
    ): SharedReportResponse =
        if (token == "locked" && password == null) {
            throw HttpException(
                Response.error<Unit>(
                    401,
                    """{"code":"SHARE_PASSWORD_REQUIRED"}""".toResponseBody("application/json".toMediaType()),
                ),
            )
        } else {
            SharedReportResponse(ok = true, report = SharedReportBody(domain = "example.com", markdownText = "Body"))
        }

    override suspend fun getSharedTeaser(token: String): SharedTeaserResponse =
        SharedTeaserResponse(ok = true, teaser = SharedTeaserBody(domain = "example.com", verdict = "V", topFix = "F"))

    override suspend fun createShare(body: ShareCreateRequest): ShareCreateResponse =
        ShareCreateResponse(ok = true, url = "https://www.luminarasuite.com/share/abc")

    override suspend fun getWorkspace(): WorkspaceResponse = workspace

    override suspend fun putWorkspace(body: WorkspacePutRequest): WorkspacePutResponse {
        if (conflictsLeft > 0) {
            conflictsLeft -= 1
            workspace = workspace.copy(updatedAt = workspace.updatedAt + 1)
            throw HttpException(Response.error<Unit>(409, "{}".toResponseBody("application/json".toMediaType())))
        }
        lastWorkspacePut = body
        return WorkspacePutResponse(ok = true, updatedAt = body.baseVersion + 1)
    }

    override suspend fun getEnquiries(projectId: String): EnquiryDeskResponse =
        EnquiryDeskResponse(ok = true, enquiries = listOf(EnquiryRecord(id = "e1", contactName = "Sam")))

    override suspend fun createEnquiry(body: EnquiryCreateRequest): JsonObject = JsonObject(emptyMap())

    override suspend fun enquiryTurn(
        id: String,
        body: EnquiryTurnRequest,
    ): JsonObject {
        enquiryTurns += id to body
        return JsonObject(emptyMap())
    }

    override suspend fun enquiryTakeover(
        id: String,
        body: EnquiryTakeoverRequest,
    ): JsonObject = JsonObject(emptyMap())

    override suspend fun decideAppointment(
        id: String,
        body: AppointmentDecisionRequest,
    ): JsonObject = JsonObject(emptyMap())

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

    var bootQuota: QuotaStatus =
        QuotaStatus(
            ok = true,
            authenticated = true,
            plan = "free",
            limit = 3,
            remaining = 2,
            entitlement = HostedEntitlement(tier = "free", name = "Free", status = "none"),
        )
    var groqCalls: Int = 0

    override suspend fun getAccountBoot(): BootResponse =
        BootResponse(
            ok = true,
            accountId = "fb:uid123",
            quota = bootQuota,
        )

    override suspend fun deleteAccount(body: AccountDeleteRequest): AccountDeleteResponse =
        AccountDeleteResponse(ok = body.confirm == "DELETE", rows = 8, firebaseDeleted = true)

    override suspend fun requestDataExport(): PrivacyExportResponse =
        PrivacyExportResponse(ok = true, jobId = "exp-1", status = "ready", message = "Export ready.")

    override suspend fun searchTavily(
        providerKey: String?,
        auditRun: String?,
        auditDomain: String?,
        body: TavilySearchRequest,
    ): TavilySearchResponse =
        if (searchFails) {
            throw IllegalStateException("search down")
        } else {
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
        }

    var streamBody: String =
        "data: {\"choices\":[{\"delta\":{\"content\":\"VERDICT: Publish /llms.txt \\u2014 now.\\n\"}}]}\n\n" +
            "data: {\"choices\":[{\"delta\":{\"content\":\"NEXT_ACTION: Add H1.\"}}]}\n\n" +
            "data: [DONE]\n\n"

    override suspend fun streamGroq(
        providerKey: String?,
        acceptFallback: String,
        body: GroqChatRequest,
    ): ResponseBody = streamBody.toResponseBody("text/event-stream".toMediaType())

    override suspend fun beginAuditRun(body: AuditRunRequest): AuditRunResponse =
        AuditRunResponse(token = "run", domain = body.domain)

    var scrapedPage: FirecrawlPage? = null
    var searchFails = false
    val refundBodies = mutableListOf<JsonObject>()
    val providerRunTokens = mutableListOf<String?>()

    override suspend fun firecrawlMap(
        auditRun: String,
        auditDomain: String,
        body: FirecrawlMapRequest,
    ): FirecrawlMapResponse {
        providerRunTokens += auditRun
        return FirecrawlMapResponse()
    }

    override suspend fun firecrawlScrape(
        auditRun: String,
        auditDomain: String,
        body: FirecrawlScrapeRequest,
    ): FirecrawlScrapeResponse {
        providerRunTokens += auditRun
        return FirecrawlScrapeResponse(data = scrapedPage)
    }

    override suspend fun refundAuditRun(body: JsonObject): AuditRunResponse {
        refundBodies += body
        return AuditRunResponse()
    }

    override suspend fun listIdeas(): IdeaListResponse = IdeaListResponse(ok = true)

    override suspend fun createIdea(
        providerKey: String?,
        body: IdeaCreateRequest,
    ): IdeaCreateResponse = IdeaCreateResponse(ok = true, id = "is_1", card = IdeaCard(problem = body.idea))

    override suspend fun getIdea(id: String): IdeaDetailResponse = IdeaDetailResponse(ok = true, card = IdeaCard())

    override suspend fun chatGroq(
        providerKey: String?,
        acceptFallback: String,
        auditRun: String?,
        auditDomain: String?,
        body: GroqChatRequest,
    ): GroqChatResponse {
        groqCalls += 1
        lastChat = body
        chatFailure?.let { throw it }
        return GroqChatResponse(
            choices =
            listOf(
                GroqChoice(
                    message =
                    GroqMessage(
                        role = "assistant",
                        content =
                        chatReply
                            ?: (
                                "VERDICT: Publish /llms.txt \u2014 and allow GPTBot.\n" +
                                    "NEXT_ACTION: Add H1 and canonical links to /llms.txt."
                                ),
                    ),
                ),
            ),
        )
    }
}

class LuminaraRepositoryTest {
    private suspend fun byokRepo(api: FakeLuminaraApi): DefaultLuminaraRepository {
        val vault = InMemoryVaultStorage()
        vault.saveByokKeys(ByokKeyBag(groqKey = "gsk_test"))
        return DefaultLuminaraRepository(api = api, dao = FakeLuminaraDao(), vault = vault)
    }

    @Test
    fun askOracle_blankModelReplyIsAnErrorNotAFakeVerdict() =
        runTest {
            val repo = byokRepo(FakeLuminaraApi().apply { chatReply = "" })

            val result = repo.askOracle("What is llms.txt?")

            assertEquals("The AI did not answer. Try again.", result.exceptionOrNull()?.message)
        }

    @Test
    fun askOracle_readsMarkdownLabels() =
        runTest {
            val api = FakeLuminaraApi().apply { chatReply = "**VERDICT:** Ship it.\n**NEXT_ACTION:** Add llms.txt." }

            val turn = byokRepo(api).askOracle("What now?").getOrThrow()

            assertEquals("Ship it.", turn.verdict)
            assertEquals("Add llms.txt.", turn.nextAction)
        }

    @Test
    fun askOracle_tellsTheModelTheLastAuditedSite() =
        runTest {
            val api = FakeLuminaraApi()
            val repo = byokRepo(api)
            repo.runInstantAudit("example.com").getOrThrow()

            repo.askOracle("What is missing on my site?").getOrThrow()

            assertTrue(requireNotNull(api.lastChat).messages.last().content.contains("example.com"))
        }

    @Test
    fun offlineFailuresUseFriendlyCopy() =
        runTest {
            val api = FakeLuminaraApi().apply { filesFailure = IOException("Unable to resolve host") }
            val repo = byokRepo(api)

            val message = repo.runInstantAudit("example.com").exceptionOrNull()?.message

            assertEquals("Could not reach Luminara. Check your connection and try again.", message)
        }

    @Test
    fun runInstantAudit_closesCrawlerFindingsThatNowPass() =
        runTest {
            val api = FakeLuminaraApi()
            val repo = byokRepo(api)
            repo.runInstantAudit("example.com").getOrThrow()
            val failing = repo.findingsFlow.first().filter { it.stableKey.startsWith("crawler::") }
            assertTrue(failing.any { it.status == "open" })

            api.snapshotToReturn =
                api.snapshotToReturn.copy(
                    llmsTxt = "# Example\n\n> Summary\n\n## Docs\n- [Home](https://example.com/)\n",
                    llmsHttpStatus = 200,
                    aiTxt = "User-agent: *\nAllow: /",
                    aiHttpStatus = 200,
                )
            repo.runInstantAudit("example.com").getOrThrow()

            assertTrue(repo.findingsFlow.first().none { it.status != "done" })
        }

    @Test
    fun generateAudioOverview_truncatedReplyGivesFriendlyError() =
        runTest {
            val repo = byokRepo(FakeLuminaraApi().apply { chatReply = "{\"title\":\"cut off" })
            repo.addStudioSource("Note", "Text", "note")

            val message = repo.generateAudioOverview().exceptionOrNull()?.message

            assertEquals("The briefing came back empty. Try again.", message)
        }

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
    fun runInstantAudit_signedInStoresRealScoresAndMetersEveryProviderCall() =
        runTest {
            val dao = FakeLuminaraDao()
            val api =
                FakeLuminaraApi().apply {
                    scrapedPage =
                        FirecrawlPage(
                            markdown = List(300) { "word" }.joinToString(" "),
                            rawHtml =
                            """<script type="application/ld+json">{"@type":"Organization"}</script>""",
                        )
                }
            val repo = DefaultLuminaraRepository(api = api, dao = dao, vault = InMemoryVaultStorage())
            repo.signIn("operator@luminarasuite.com", "password123")

            val stages = mutableListOf<String>()
            val report = repo.runInstantAudit("example.com") { stages += it }.getOrThrow()

            val crew = requireNotNull(report.crew)
            assertEquals("measured", crew.measurementStatus)
            assertEquals(crew.healthScore, report.healthScore)
            assertTrue(api.refundBodies.isEmpty())
            assertTrue(api.providerRunTokens.all { it == "run" })
            assertTrue("Reading your pages" in stages)
            val stored = repo.auditHistoryFlow.first().first()
            assertEquals(crew.healthScore, stored.healthScore)
            assertEquals(crew.citationRatePercent, stored.citationRatePercent)
        }

    @Test
    fun runInstantAudit_refundsTheCheckWhenNothingWasMeasured() =
        runTest {
            val api = FakeLuminaraApi().apply { scrapedPage = null }
            val repo = DefaultLuminaraRepository(api = api, dao = FakeLuminaraDao(), vault = InMemoryVaultStorage())
            repo.signIn("operator@luminarasuite.com", "password123")
            api.searchFails = true

            val report = repo.runInstantAudit("example.com").getOrThrow()

            assertNull(report.healthScore)
            assertNull(report.crew?.citationRatePercent)
            assertEquals("not_measured", report.crew?.measurementStatus)
            assertEquals(1, api.refundBodies.size)
            assertNull(repo.auditHistoryFlow.first().first().citationRatePercent)
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
    fun askOracle_gatesHostedCallsOnTheWorkerAllowance() =
        runTest {
            val api = FakeLuminaraApi()
            val vault = InMemoryVaultStorage()
            val repo = DefaultLuminaraRepository(api = api, dao = FakeLuminaraDao(), vault = vault)

            repo.signIn("operator@luminarasuite.com", "password123")
            val hosted = repo.askOracle("How do I fix llms.txt?")
            assertTrue(hosted.isSuccess)
            assertEquals("Groq LPU (Hosted)", hosted.getOrThrow().modelLabel)
            assertEquals(1, api.groqCalls)

            api.bootQuota =
                api.bootQuota.copy(
                    remaining = 0,
                    used = 3,
                    entitlement = HostedEntitlement(tier = "free", name = "Free", status = "none"),
                )
            val blocked = repo.askOracle("How do I fix llms.txt?")
            assertTrue(blocked.isFailure)
            assertEquals(1, api.groqCalls)

            api.bootQuota =
                QuotaStatus(
                    ok = true,
                    authenticated = true,
                    plan = "growth",
                    limit = -1,
                    remaining = -1,
                    isUnlimited = true,
                    entitlement = HostedEntitlement(tier = "growth", name = "Growth", status = "active"),
                )
            val paid = repo.askOracle("How do I fix llms.txt?")
            assertTrue(paid.isSuccess)
            assertEquals(2, api.groqCalls)

            api.bootQuota = api.bootQuota.copy(remaining = 0, isUnlimited = false, limit = 3, plan = "free")
            repo.saveByokKeys(ByokKeyBag(groqKey = "gsk_test_key"))
            val byok = repo.askOracle("How do I fix llms.txt?")
            assertTrue(byok.isSuccess)
            assertEquals("Groq LPU (BYOK)", byok.getOrThrow().modelLabel)
            assertEquals(3, api.groqCalls)
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

    @Test
    fun streamOracle_emitsPartialsThenStructuredTurn() =
        runTest {
            val repo =
                DefaultLuminaraRepository(
                    api = FakeLuminaraApi(),
                    dao = FakeLuminaraDao(),
                    vault = InMemoryVaultStorage(VaultSnapshot(idToken = "t", email = "a@b.co")),
                )

            val events = repo.streamOracle("Check citations", emptyList()).toList()

            assertTrue(events.any { it is OracleEvent.Partial })
            val turn = (events.last() as OracleEvent.Complete).turn
            assertEquals("Publish /llms.txt - now.", turn.verdict)
            assertEquals("Add H1.", turn.nextAction)
        }

    @Test
    fun streamOracle_acceptsPlainJsonFallback() =
        runTest {
            val api = FakeLuminaraApi()
            api.streamBody =
                "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"VERDICT: Yes\\nNEXT_ACTION: Go\"}}]}"
            val repo =
                DefaultLuminaraRepository(
                    api = api,
                    dao = FakeLuminaraDao(),
                    vault = InMemoryVaultStorage(VaultSnapshot(idToken = "t", email = "a@b.co")),
                )

            val turn = (repo.streamOracle("Q", emptyList()).toList().last() as OracleEvent.Complete).turn

            assertEquals("Yes", turn.verdict)
        }
}
