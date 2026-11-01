package com.luminarasuite.app

import android.Manifest
import android.app.UiAutomation
import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.luminarasuite.app.core.auth.VaultSnapshot
import com.luminarasuite.app.core.model.CrawlerEvaluationResult
import com.luminarasuite.app.core.model.CrewPage
import com.luminarasuite.app.core.model.CrewRules
import com.luminarasuite.app.core.model.CrewSchema
import com.luminarasuite.app.core.model.ReadinessCheck
import com.luminarasuite.app.core.model.SearchRow
import com.luminarasuite.app.core.model.ShareLink
import com.luminarasuite.app.core.network.InstantAuditReport
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.core.reminders.NextFixReminder
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

private const val POST_TIMEOUT_MS = 5_000L

private val failedLlms = ReadinessCheck("llms_txt", "llms.txt present", "fail", "HTTP 404.")

/** Signed-in screens driven by stub data, because they need an account and undeployed routes. */
private class SignedInRepository(
    private val inner: LuminaraRepository = StubInstrumentationRepository(),
) : LuminaraRepository by inner {
    override val vaultFlow = MutableStateFlow(VaultSnapshot(idToken = "stub", email = "demo@example.com"))

    override suspend fun runInstantAudit(
        rawDomain: String,
        onStage: (String) -> Unit,
    ): Result<InstantAuditReport> {
        val pages =
            listOf(
                CrewPage(
                    url = "https://example.com",
                    title = "Example Co",
                    schemas = listOf(CrewSchema("WebSite", null)),
                    wordCount = 180,
                    textSnippet = "Stub page",
                ),
            )
        val rows =
            List(3) { SearchRow("what is example.com", "Stub result $it", "https://other.test/$it", "x", it == 0) }
        val crew = CrewRules.assess("example.com", pages, rows, listOf(failedLlms))
        return Result.success(
            InstantAuditReport(
                domain = "example.com",
                probeNote = "Stub",
                evaluation =
                CrawlerEvaluationResult(
                    domain = "example.com",
                    measurementStatus = "measured",
                    checks = listOf(failedLlms),
                    botMatrix = emptyList(),
                    passCount = 0,
                    failCount = 1,
                ),
                verdict = crew.brief.takeaway,
                oneMoveThisWeek = crew.findings.first().title,
                healthScore = crew.healthScore,
                receiptNote = "Stub data for a screen check.",
                crew = crew,
            ),
        )
    }
}

@RunWith(AndroidJUnit4::class)
class ParityScreensTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val dir = requireNotNull(instrumentation.targetContext.getExternalFilesDir("parity"))
        File(dir, "$name.png").outputStream().use { out ->
            composeRule.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, out)
        }
    }

    private fun open() {
        composeRule.setContent {
            LuminaraWorkbenchApp(repository = SignedInRepository(), workspace = StubWorkspace())
        }
        composeRule.waitForIdle()
    }

    @Test
    fun fullAuditShowsScoresEvidenceAndFixes() {
        open()
        composeRule.onNodeWithTag("nav_tab_audit").performClick()
        composeRule.onNodeWithTag("audit_domain_input").performTextInput("example.com")
        composeRule.onNodeWithTag("run_audit_button").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("65/100").performScrollTo()
        capture("audit-scores")
        composeRule.onNodeWithTag("audit_citation_rate").assertTextEquals("33%")
        composeRule.onNodeWithTag("copy_patch-schema-org").performScrollTo()
        capture("audit-fixes")
        composeRule.onNodeWithText("Stub result 2").performScrollTo()
        capture("audit-evidence")
    }

    @Test
    fun businessProfileAndEnquiryDeskOpenFromSettings() {
        open()
        composeRule.onNodeWithTag("nav_tab_settings").performClick()
        composeRule.onNodeWithTag("open_profile_button").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Acme").assertExists()
        capture("business-profile")
        composeRule.onNodeWithTag("nav_tab_settings").performClick()
        composeRule.onNodeWithTag("open_enquiries_button").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Sam").performClick()
        composeRule.onNodeWithTag("enquiry_takeover_button").assertExists()
        capture("enquiry-desk")
    }

    @Test
    fun theSameLinkOpensAgainAfterBack() {
        val links = MutableStateFlow<ShareLink?>(ShareLink("a".repeat(64), isTeaser = false))
        composeRule.setContent {
            LuminaraWorkbenchApp(
                repository = SignedInRepository(),
                workspace = StubWorkspace(),
                sharedLinks = links,
                onSharedLinkOpened = { links.value = null },
            )
        }
        composeRule.onNodeWithTag("share_body").assertExists()
        composeRule.onNodeWithTag("brand_mark").performClick()
        composeRule.waitUntil { composeRule.onAllNodesWithTag("share_body").fetchSemanticsNodes().isEmpty() }
        links.value = ShareLink("a".repeat(64), isTeaser = false)
        composeRule.waitUntil { composeRule.onAllNodesWithTag("share_body").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun reminderPostsTheTopFix() {
        val context = instrumentation.targetContext
        // Compose keeps its own connection open, and a default reconnect here can hang.
        instrumentation
            .getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
            .grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        NextFixReminder.setEnabled(context, true)
        NextFixReminder.post(context, "example.com: Add a business identity tag")
        check(!NextFixReminder.needsPermission(context)) { "Permission grant did not apply" }
        val notifications = context.getSystemService(android.app.NotificationManager::class.java)
        // The system posts on its own thread, so the notification appears a moment later.
        composeRule.waitUntil(POST_TIMEOUT_MS) {
            notifications.activeNotifications.any { it.id == NextFixReminder.NOTIFICATION_ID }
        }
        NextFixReminder.setEnabled(context, false)
    }
}
