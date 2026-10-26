package com.luminarasuite.app

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.luminarasuite.app.core.auth.InMemoryVaultStorage
import com.luminarasuite.app.core.model.AuditFinding
import com.luminarasuite.app.core.model.AuditHistoryEntry
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.model.CrawlerEvaluationResult
import com.luminarasuite.app.core.model.OracleTurn
import com.luminarasuite.app.core.model.QuotaStatus
import com.luminarasuite.app.core.model.ScoutRecheckResponse
import com.luminarasuite.app.core.network.InstantAuditReport
import com.luminarasuite.app.core.network.LuminaraRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

class StubInstrumentationRepository : LuminaraRepository {
    private val vault = InMemoryVaultStorage()
    override val vaultFlow = vault.snapshotFlow
    override val auditHistoryFlow: Flow<List<AuditHistoryEntry>> = MutableStateFlow(emptyList())
    override val findingsFlow: Flow<List<AuditFinding>> = MutableStateFlow(emptyList())

    override suspend fun runInstantAudit(rawDomain: String): Result<InstantAuditReport> =
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

    override suspend fun askOracle(question: String): Result<OracleTurn> =
        Result.success(
            OracleTurn(
                id = "1",
                question = question,
                verdict = "Verdict",
                nextAction = "Action",
                sources = emptyList(),
                modelLabel = "Groq",
                measurementStatus = "measured",
                timestampMs = 1L,
            ),
        )

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

    override suspend fun signUp(
        email: String,
        password: String,
    ): Result<QuotaStatus?> = Result.success(null)

    override suspend fun refreshQuota(): Result<QuotaStatus?> = Result.success(null)

    override suspend fun saveByokKeys(bag: ByokKeyBag) = Unit

    override suspend fun signOut() = Unit

    override suspend fun exportAccountData(): Result<String> = Result.success("Exported")

    override suspend fun deleteAccountPermanently(confirmText: String): Result<Unit> = Result.success(Unit)
}

@RunWith(AndroidJUnit4::class)
class LuminaraWorkbenchSmokeTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun workbenchTabs_navigateAcrossAllFourSurfaces() {
        composeRule.setContent {
            LuminaraWorkbenchApp(repository = StubInstrumentationRepository())
        }
        composeRule.onNodeWithTag("nav_tab_audit").assertExists()
        composeRule.onNodeWithTag("nav_tab_ask").performClick()
        composeRule.onNodeWithTag("ask_submit_button").assertExists()
        composeRule.onNodeWithTag("nav_tab_dashboard").performClick()
        composeRule.onNodeWithTag("dashboard_sync_button").assertExists()
        composeRule.onNodeWithTag("nav_tab_settings").performClick()
        composeRule.onNodeWithTag("save_byok_button").assertExists()
    }

    @Test
    fun roomExportedSchema_isBundledInTestAssets() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val schemas =
            context.assets.list("com.luminarasuite.app.core.database.LuminaraDatabase").orEmpty()
        assertTrue(schemas.contains("1.json"))
    }
}
