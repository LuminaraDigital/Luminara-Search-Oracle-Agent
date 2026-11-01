package com.luminarasuite.app.feature

import com.luminarasuite.app.core.auth.InMemoryVaultStorage
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.model.CrawlerFilesSnapshot
import com.luminarasuite.app.core.network.DefaultLuminaraRepository
import com.luminarasuite.app.core.network.DefaultWorkspaceGateway
import com.luminarasuite.app.core.network.FakeLuminaraApi
import com.luminarasuite.app.core.network.FakeLuminaraDao
import com.luminarasuite.app.feature.ask.AskViewModel
import com.luminarasuite.app.feature.audit.AuditViewModel
import com.luminarasuite.app.feature.dashboard.DashboardViewModel
import com.luminarasuite.app.feature.enquiry.EnquiryDeskViewModel
import com.luminarasuite.app.feature.settings.SettingsViewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ViewModelsTest {
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    /** streamOracle runs on Dispatchers.IO, so the test waits on real time, not the scheduler. */
    private fun waitForTurns(vm: AskViewModel) {
        repeat(200) {
            if (vm.uiState.value.turns.isNotEmpty()) return
            Thread.sleep(10)
        }
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun enquiryDesk(api: FakeLuminaraApi): EnquiryDeskViewModel {
        val repo = DefaultLuminaraRepository(api = api, dao = FakeLuminaraDao(), vault = InMemoryVaultStorage())
        return EnquiryDeskViewModel(DefaultWorkspaceGateway(api), repo).apply {
            updateName("Sam")
            updateMessage("Need an appraisal")
        }
    }

    @Test
    fun enquiryDesk_keepsTypedTextWhenTheSaveFails() =
        runTest {
            val vm = enquiryDesk(FakeLuminaraApi().apply { enquiryFails = true })
            vm.create()
            assertEquals("Sam", vm.uiState.value.name)
            assertEquals("offline", vm.uiState.value.errorMessage)
        }

    @Test
    fun enquiryDesk_clearsTheFormAfterASaveAndResetDropsTheAccountData() =
        runTest {
            val vm = enquiryDesk(FakeLuminaraApi())
            vm.create()
            assertEquals("", vm.uiState.value.name)
            assertEquals(1, vm.uiState.value.enquiries.size)
            vm.reset()
            assertTrue(vm.uiState.value.enquiries.isEmpty())
        }

    @Test
    fun enquiryDesk_resetStopsAnInFlightLoadWritingOldAccountData() =
        runTest {
            val gate = CompletableDeferred<Unit>()
            val api = FakeLuminaraApi().apply { enquiriesGate = gate }
            val vm = enquiryDesk(api)
            vm.load()
            vm.reset()
            gate.complete(Unit)
            assertTrue(vm.uiState.value.enquiries.isEmpty())
            assertFalse(vm.uiState.value.isBusy)
        }

    @Test
    fun auditViewModel_runsAuditRechecksCheckAndReportsVerdict() =
        runTest {
            val api = FakeLuminaraApi()
            val repo =
                DefaultLuminaraRepository(
                    api = api,
                    dao = FakeLuminaraDao(),
                    vault = InMemoryVaultStorage(),
                )
            val vm = AuditViewModel(repo)

            vm.runAudit("")
            assertNotNull(vm.uiState.value.errorMessage)

            vm.runAudit("luminarasuite.com")
            assertNull(vm.uiState.value.errorMessage)
            assertNotNull(vm.uiState.value.report)
            assertEquals("luminarasuite.com", vm.uiState.value.report?.domain)
            assertEquals("fail", vm.uiState.value.report?.evaluation?.checks?.first { it.id == "llms_txt" }?.status)

            api.snapshotToReturn =
                CrawlerFilesSnapshot(
                    llmsTxt = "# Luminara\n> AI Search Oracle\n- [Docs](https://luminarasuite.com/docs)",
                    llmsHttpStatus = 200,
                    robotsTxt = "User-agent: *\nAllow: /",
                    robotsHttpStatus = 200,
                    aiTxt = "User-agent: *\nAllow: /",
                    aiHttpStatus = 200,
                )
            vm.recheckCheck("llms_txt")
            assertEquals("pass", vm.uiState.value.report?.evaluation?.checks?.first { it.id == "llms_txt" }?.status)

            vm.reportAuditVerdict()
            assertTrue(vm.uiState.value.isVerdictReported)
        }

    @Test
    fun askViewModel_submitsQuestionAndFlagsReportedTurn() =
        runTest {
            val vault = InMemoryVaultStorage()
            vault.saveByokKeys(ByokKeyBag(groqKey = "gsk_live_test"))
            val repo =
                DefaultLuminaraRepository(
                    api = FakeLuminaraApi(),
                    dao = FakeLuminaraDao(),
                    vault = vault,
                )
            val vm = AskViewModel(repo)

            vm.submitQuestion("Check AEO citations")
            waitForTurns(vm)
            assertEquals(1, vm.uiState.value.turns.size)
            val turnId = vm.uiState.value.turns.first().id

            vm.reportTurn(turnId)
            assertTrue(vm.uiState.value.turns.first().isReported)
        }

    @Test
    fun dashboardViewModel_observesFindingsCyclesStatusAndSyncs() =
        runTest {
            val repo =
                DefaultLuminaraRepository(
                    api = FakeLuminaraApi(),
                    dao = FakeLuminaraDao(),
                    vault = InMemoryVaultStorage(),
                )
            val vm = DashboardViewModel(repo)

            repo.runInstantAudit("example.com")
            assertEquals(1, vm.uiState.value.history.size)
            assertTrue(vm.uiState.value.findings.isNotEmpty())

            val firstFinding = vm.uiState.value.findings.first()
            assertEquals("open", firstFinding.status)

            vm.cycleFindingStatus(firstFinding)
            val inProgress = vm.uiState.value.findings.first { it.id == firstFinding.id }
            assertEquals("in_progress", inProgress.status)

            vm.cycleFindingStatus(inProgress)
            val done = vm.uiState.value.findings.first { it.id == firstFinding.id }
            assertEquals("done", done.status)

            vm.syncFromCloud()
            assertNotNull(vm.uiState.value.syncMessage)
        }

    @Test
    fun settingsViewModel_preservesUnsavedKeyEditsAndHandlesAuthLifecycle() =
        runTest {
            val repo =
                DefaultLuminaraRepository(
                    api = FakeLuminaraApi(),
                    dao = FakeLuminaraDao(),
                    vault = InMemoryVaultStorage(),
                )
            val vm = SettingsViewModel(repo)

            vm.updateGroqKey("gsk_unsaved_draft")
            repo.reportOracleTurn("turn-1")
            assertEquals("gsk_unsaved_draft", vm.uiState.value.groqKeyInput)

            vm.saveByokKeys()
            assertEquals("gsk_unsaved_draft", vm.uiState.value.vault.byokKeys.groqKey)

            vm.updateEmail("user@luminarasuite.com")
            vm.updatePassword("password123")
            vm.signUp()
            assertTrue(vm.uiState.value.vault.isSignedIn)

            vm.exportData()
            assertEquals("Export ready.", vm.uiState.value.statusBanner)

            assertEquals("free", vm.uiState.value.quota?.plan)
            assertEquals("free", vm.uiState.value.quota?.entitlement?.tier)
            assertEquals(2, vm.uiState.value.quota?.remaining)

            vm.signOut()
            assertFalse(vm.uiState.value.vault.isSignedIn)
            assertNull(vm.uiState.value.quota)

            vm.updateEmail("user@luminarasuite.com")
            vm.updatePassword("password123")
            vm.signIn()
            assertTrue(vm.uiState.value.vault.isSignedIn)

            vm.updateDeleteConfirm("DELETE")
            vm.deleteAccount()
            assertFalse(vm.uiState.value.vault.isSignedIn)
        }
}
