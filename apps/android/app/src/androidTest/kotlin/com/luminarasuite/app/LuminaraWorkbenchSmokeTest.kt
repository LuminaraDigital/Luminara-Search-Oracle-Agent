package com.luminarasuite.app

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.luminarasuite.app.core.auth.InMemoryVaultStorage
import com.luminarasuite.app.core.model.AudioOverview
import com.luminarasuite.app.core.model.AuditFinding
import com.luminarasuite.app.core.model.AuditHistoryEntry
import com.luminarasuite.app.core.model.BusinessDna
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.model.CrawlerEvaluationResult
import com.luminarasuite.app.core.model.EnquiryCreateRequest
import com.luminarasuite.app.core.model.EnquiryDeskResponse
import com.luminarasuite.app.core.model.EnquiryRecord
import com.luminarasuite.app.core.model.IdeaCard
import com.luminarasuite.app.core.model.IdeaCreateRequest
import com.luminarasuite.app.core.model.IdeaCreateResponse
import com.luminarasuite.app.core.model.IdeaSummary
import com.luminarasuite.app.core.model.OracleTurn
import com.luminarasuite.app.core.model.QuotaStatus
import com.luminarasuite.app.core.model.ScoutRecheckResponse
import com.luminarasuite.app.core.model.ShareLink
import com.luminarasuite.app.core.model.SharedDocument
import com.luminarasuite.app.core.model.StudioSource
import com.luminarasuite.app.core.network.AuditRead
import com.luminarasuite.app.core.network.InstantAuditReport
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.core.network.OracleEvent
import com.luminarasuite.app.core.network.WorkspaceGateway
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

class StubWorkspace : WorkspaceGateway {
    override suspend fun openShared(
        link: ShareLink,
        password: String?,
    ) = Result.success(SharedDocument(title = "example.com", body = "Shared body"))

    override suspend fun createShareLink(
        text: String,
        domain: String?,
    ) = Result.success("https://www.luminarasuite.com/share/abc")

    override suspend fun loadProfile() = Result.success(BusinessDna(name = "Acme"))

    override suspend fun saveProfile(profile: BusinessDna) = Result.success(Unit)

    override suspend fun loadEnquiries() =
        Result.success(
            EnquiryDeskResponse(ok = true, enquiries = listOf(EnquiryRecord(id = "e1", contactName = "Sam"))),
        )

    override suspend fun createEnquiry(request: EnquiryCreateRequest) = Result.success(Unit)

    override suspend fun replyToEnquiry(
        id: String,
        text: String,
    ) = Result.success(Unit)

    override suspend fun setEnquiryPaused(
        id: String,
        paused: Boolean,
    ) = Result.success(Unit)

    override suspend fun decideAppointment(
        id: String,
        approve: Boolean,
        slotId: String?,
    ) = Result.success(Unit)
}

class StubInstrumentationRepository : LuminaraRepository {
    private val vault = InMemoryVaultStorage()
    override val vaultFlow = vault.snapshotFlow
    override val auditHistoryFlow: Flow<List<AuditHistoryEntry>> = MutableStateFlow(emptyList())
    override val findingsFlow: Flow<List<AuditFinding>> = MutableStateFlow(emptyList())

    override val studioSourcesFlow: Flow<List<StudioSource>> = MutableStateFlow(emptyList())

    override val quotaFlow: StateFlow<QuotaStatus?> = MutableStateFlow(null)

    override suspend fun runInstantAudit(
        rawDomain: String,
        onStage: (String) -> Unit,
    ): Result<InstantAuditReport> =
        Result.success(
            InstantAuditReport(
                domain = "luminarasuite.com",
                probeNote = "OK",
                evaluation =
                CrawlerEvaluationResult(
                    domain = "luminarasuite.com",
                    measurementStatus = "measured",
                    checks = emptyList(),
                    botMatrix = emptyList(),
                    passCount = 5,
                    failCount = 0,
                ),
                verdict = "Healthy",
                oneMoveThisWeek = "Maintain llms.txt",
                healthScore = null,
                receiptNote = "Verified",
            ),
        )

    override suspend fun recheckSingleCheck(
        domain: String,
        checkId: String,
    ): Result<ScoutRecheckResponse> = Result.success(ScoutRecheckResponse(ok = true, passed = true))

    private fun askOracleStub(question: String) =
        OracleTurn(
            id = "1",
            question = question,
            verdict = "Verdict",
            nextAction = "Action",
            sources = emptyList(),
            modelLabel = "Groq",
            measurementStatus = "measured",
            timestampMs = 1L,
        )

    override suspend fun askOracle(question: String): Result<OracleTurn> = Result.success(askOracleStub(question))

    override fun streamOracle(
        question: String,
        earlierTurns: List<OracleTurn>,
    ): Flow<OracleEvent> = flowOf(OracleEvent.Complete(askOracleStub(question)))

    override suspend fun explainAudit(report: InstantAuditReport): Result<AuditRead> =
        Result.success(AuditRead("Read", "Move"))

    override suspend fun listIdeas(): Result<List<IdeaSummary>> = Result.success(emptyList())

    override suspend fun createIdea(request: IdeaCreateRequest): Result<IdeaCreateResponse> =
        Result.success(IdeaCreateResponse(ok = true))

    override suspend fun getIdeaCard(id: String): Result<IdeaCard> = Result.success(IdeaCard())

    override suspend fun addStudioSource(
        title: String,
        content: String,
        kind: String,
    ) = Unit

    override suspend fun setStudioSourceSelected(
        id: String,
        selected: Boolean,
    ) = Unit

    override suspend fun removeStudioSource(id: String) = Unit

    override suspend fun askStudio(question: String): Result<String> = Result.success("Answer")

    override suspend fun generateAudioOverview(): Result<AudioOverview> = Result.success(AudioOverview())

    override suspend fun reportOracleTurn(turnId: String) = Unit

    override suspend fun refreshDashboard(): Result<Unit> = Result.success(Unit)

    override suspend fun updateFindingStatus(
        findingId: String,
        newStatus: String,
    ): Result<Unit> = Result.success(Unit)

    override suspend fun signIn(
        email: String,
        password: String,
    ): Result<QuotaStatus?> = Result.success(null)

    override suspend fun signInWithGoogle(googleIdToken: String): Result<QuotaStatus?> = Result.success(null)

    override suspend fun requestPasswordReset(email: String): Result<String> = Result.success("Sent")

    override suspend fun signUp(
        email: String,
        password: String,
    ): Result<QuotaStatus?> = Result.success(null)

    override suspend fun refreshQuota(): Result<QuotaStatus?> = Result.success(null)

    override suspend fun saveByokKeys(bag: ByokKeyBag) = Unit

    override suspend fun setDeveloperByok(enabled: Boolean) {
        vault.setDeveloperByok(enabled)
    }

    override suspend fun signOut() = Unit

    override suspend fun exportAccountData(): Result<String> = Result.success("Exported")

    override suspend fun deleteAccountPermanently(confirmText: String): Result<Unit> = Result.success(Unit)
}

@RunWith(AndroidJUnit4::class)
class LuminaraWorkbenchSmokeTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun sharedLinkOpensTheViewerWithReportAiOutput() {
        val link = ShareLink("a".repeat(64), isTeaser = false)
        composeRule.setContent {
            LuminaraWorkbenchApp(
                repository = StubInstrumentationRepository(),
                workspace = StubWorkspace(),
                sharedLinks = MutableStateFlow(link),
                showWelcome = true,
            )
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("share_body").assertExists()
        composeRule.onNodeWithText("Report AI output").assertExists()
    }

    @Test
    fun workbenchTabs_navigateAndExecuteActionsAcrossAllFourSurfaces() {
        composeRule.setContent {
            LuminaraWorkbenchApp(repository = StubInstrumentationRepository(), workspace = StubWorkspace())
        }
        composeRule.onNodeWithTag("nav_tab_audit").assertExists().performClick()
        composeRule.onNodeWithTag("audit_domain_input").performTextInput("luminarasuite.com")
        composeRule.onNodeWithTag("run_audit_button").performClick()
        composeRule.onNodeWithTag("report_audit_button").assertExists().performClick()

        composeRule.onNodeWithTag("nav_tab_ask").performClick()
        composeRule.onNodeWithTag("ask_prompt_input").performTextInput("Check llms.txt")
        composeRule.onNodeWithTag("ask_submit_button").assertExists().performClick()

        composeRule.onNodeWithTag("nav_tab_home").performClick()
        composeRule.onNodeWithTag("dashboard_sync_button").assertExists().performClick()

        composeRule.onNodeWithTag("nav_tab_settings").performClick()
        composeRule.onNodeWithTag("developer_byok_switch").assertExists().performClick()
        composeRule.onNodeWithTag("save_byok_button").assertExists().performClick()
    }

    @Test
    fun roomExportedSchema_isBundledInTestAssets() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val schemas =
            context.assets.list("com.luminarasuite.app.core.database.LuminaraDatabase").orEmpty()
        assertTrue(schemas.contains("1.json"))
        assertTrue(schemas.contains("2.json"))
    }
}
