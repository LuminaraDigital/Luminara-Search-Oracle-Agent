package com.luminarasuite.app.feature

import com.luminarasuite.app.core.auth.InMemoryVaultStorage
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.network.DefaultLuminaraRepository
import com.luminarasuite.app.core.network.FakeLuminaraApi
import com.luminarasuite.app.core.network.FakeLuminaraDao
import com.luminarasuite.app.feature.ask.AskViewModel
import com.luminarasuite.app.feature.audit.AuditViewModel
import com.luminarasuite.app.feature.settings.SettingsViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
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

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun auditViewModel_validatesEmptyInputAndRunsAudit() =
        runTest {
            val repo =
                DefaultLuminaraRepository(
                    api = FakeLuminaraApi(),
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
            assertEquals(1, vm.uiState.value.turns.size)
            val turnId = vm.uiState.value.turns.first().id

            vm.reportTurn(turnId)
            assertTrue(vm.uiState.value.turns.first().isReported)
        }

    @Test
    fun settingsViewModel_savesByokKeysAndHandlesSignInAndDelete() =
        runTest {
            val repo =
                DefaultLuminaraRepository(
                    api = FakeLuminaraApi(),
                    dao = FakeLuminaraDao(),
                    vault = InMemoryVaultStorage(),
                )
            val vm = SettingsViewModel(repo)

            vm.updateGroqKey("gsk_abc123")
            vm.saveByokKeys()
            assertEquals("gsk_abc123", vm.uiState.value.vault.byokKeys.groqKey)

            vm.updateEmail("user@luminarasuite.com")
            vm.updatePassword("password123")
            vm.signIn()
            assertTrue(vm.uiState.value.vault.isSignedIn)

            vm.updateDeleteConfirm("DELETE")
            vm.deleteAccount()
            assertTrue(!vm.uiState.value.vault.isSignedIn)
        }
}
