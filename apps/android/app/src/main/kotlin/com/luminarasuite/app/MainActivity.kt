package com.luminarasuite.app

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.luminarasuite.app.core.auth.VaultSnapshot
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraMark
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.LuminaraTheme
import com.luminarasuite.app.core.designsystem.ObsidianBackdrop
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.model.QuotaStatus
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.feature.ask.AskScreen
import com.luminarasuite.app.feature.ask.AskViewModel
import com.luminarasuite.app.feature.audit.AuditScreen
import com.luminarasuite.app.feature.audit.AuditViewModel
import com.luminarasuite.app.feature.dashboard.DashboardScreen
import com.luminarasuite.app.feature.dashboard.DashboardViewModel
import com.luminarasuite.app.feature.memory.MemoryScreen
import com.luminarasuite.app.feature.onboarding.WelcomeScreen
import com.luminarasuite.app.feature.scout.ScoutScreen
import com.luminarasuite.app.feature.scout.ScoutViewModel
import com.luminarasuite.app.feature.settings.SettingsScreen
import com.luminarasuite.app.feature.settings.SettingsViewModel
import com.luminarasuite.app.feature.studio.StudioScreen
import com.luminarasuite.app.feature.studio.StudioViewModel
import kotlinx.coroutines.flow.map

enum class LuminaraTab(
    val label: String,
    val icon: ImageVector,
    val tag: String,
) {
    HOME("Home", Icons.Outlined.Dashboard, "nav_tab_home"),
    ASK("Ask", Icons.Outlined.AutoAwesome, "nav_tab_ask"),
    SCOUT("Scout", Icons.Outlined.Explore, "nav_tab_scout"),
    AUDIT("Audit", Icons.Outlined.Assignment, "nav_tab_audit"),
    STUDIO("Studio", Icons.Outlined.Headphones, "nav_tab_studio"),
}

private enum class Overlay { MEMORY, SETTINGS }

private const val PREFS = "luminara_app"
private const val KEY_WELCOMED = "welcomed"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.Transparent.toArgb()),
            navigationBarStyle = SystemBarStyle.dark(Color.Transparent.toArgb()),
        )
        val app = application as LuminaraApplication
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        setContent {
            LuminaraTheme {
                LuminaraWorkbenchApp(
                    repository = app.repository,
                    showWelcome = !prefs.getBoolean(KEY_WELCOMED, false),
                    onWelcomed = { prefs.edit().putBoolean(KEY_WELCOMED, true).apply() },
                )
            }
        }
    }
}

@Composable
fun LuminaraWorkbenchApp(
    repository: LuminaraRepository,
    showWelcome: Boolean = false,
    onWelcomed: () -> Unit = {},
) {
    var welcome by rememberSaveable { mutableStateOf(showWelcome) }
    var selectedTab by rememberSaveable { mutableStateOf(LuminaraTab.HOME) }
    var overlay by rememberSaveable { mutableStateOf<Overlay?>(null) }
    var askSeed by rememberSaveable { mutableStateOf<String?>(null) }

    val auditViewModel = viewModel { AuditViewModel(repository) }
    val askViewModel = viewModel { AskViewModel(repository) }
    val dashboardViewModel = viewModel { DashboardViewModel(repository) }
    val settingsViewModel = viewModel { SettingsViewModel(repository) }
    val scoutViewModel = viewModel { ScoutViewModel(repository) }
    val studioViewModel = viewModel { StudioViewModel(repository) }

    val quota by repository.quotaFlow.collectAsState()
    val vault by repository.vaultFlow.collectAsState(initial = VaultSnapshot())
    LaunchedEffect(vault.isSignedIn) { repository.refreshQuota() }

    // People upgrading with saved audits already know the app, so they skip first-run.
    val hasHistory by remember { repository.auditHistoryFlow.map { it.isNotEmpty() } }
        .collectAsState(initial = false)
    LaunchedEffect(hasHistory) {
        if (hasHistory && welcome) {
            welcome = false
            onWelcomed()
        }
    }

    fun askAbout(question: String) {
        askSeed = question
        overlay = null
        selectedTab = LuminaraTab.ASK
    }

    fun auditHost(host: String?) {
        if (host != null) auditViewModel.runAudit(host)
        overlay = null
        selectedTab = LuminaraTab.AUDIT
    }

    if (welcome) {
        WelcomeScreen(
            onCheckSite = { host ->
                welcome = false
                onWelcomed()
                auditHost(host)
            },
            onSkip = {
                welcome = false
                onWelcomed()
            },
        )
        return
    }

    BackHandler(enabled = overlay != null) { overlay = null }
    BackHandler(enabled = overlay == null && selectedTab != LuminaraTab.HOME) { selectedTab = LuminaraTab.HOME }

    ObsidianBackdrop {
        Column(
            modifier =
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top)),
        ) {
            TopBar(
                quota = quota,
                vault = vault,
                onMark = {
                    overlay = null
                    selectedTab = LuminaraTab.HOME
                },
                onAccount = { overlay = Overlay.SETTINGS },
            )
            Box(
                modifier =
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .windowInsetsPadding(WindowInsets.ime.only(WindowInsetsSides.Bottom)),
            ) {
                AnimatedContent(
                    targetState = overlay?.name ?: selectedTab.name,
                    transitionSpec = { fadeIn(tween(180, delayMillis = 60)) togetherWith fadeOut(tween(60)) },
                    label = "screen",
                ) { target ->
                    when (target) {
                        Overlay.MEMORY.name ->
                            MemoryScreen(
                                viewModel = dashboardViewModel,
                                onRunAudit = { auditHost(null) },
                                onAskAbout = ::askAbout,
                            )
                        Overlay.SETTINGS.name -> SettingsScreen(viewModel = settingsViewModel)
                        LuminaraTab.ASK.name ->
                            AskScreen(
                                viewModel = askViewModel,
                                seedPrompt = askSeed,
                                onSeedConsumed = { askSeed = null },
                                onOpenSettings = { overlay = Overlay.SETTINGS },
                            )
                        LuminaraTab.SCOUT.name ->
                            ScoutScreen(
                                viewModel = scoutViewModel,
                                isSignedIn = vault.isSignedIn,
                                onSignIn = { overlay = Overlay.SETTINGS },
                                onAuditDomain = ::auditHost,
                            )
                        LuminaraTab.AUDIT.name ->
                            AuditScreen(
                                viewModel = auditViewModel,
                                onAskAbout = ::askAbout,
                            )
                        LuminaraTab.STUDIO.name -> StudioScreen(viewModel = studioViewModel)
                        else ->
                            DashboardScreen(
                                viewModel = dashboardViewModel,
                                isSignedIn = vault.isSignedIn,
                                onRunAudit = ::auditHost,
                                onAskAbout = ::askAbout,
                                onOpenMemory = { overlay = Overlay.MEMORY },
                                onOpenScout = { selectedTab = LuminaraTab.SCOUT },
                                onOpenStudio = { selectedTab = LuminaraTab.STUDIO },
                                onOpenSettings = { overlay = Overlay.SETTINGS },
                            )
                    }
                }
            }
            val keyboardOpen = WindowInsets.ime.getBottom(LocalDensity.current) > 0
            if (!keyboardOpen) {
                Dock(
                    selected = selectedTab.takeIf { overlay == null },
                    onSelect = {
                        overlay = null
                        selectedTab = it
                    },
                )
            }
        }
    }
}

@Composable
private fun TopBar(
    quota: QuotaStatus?,
    vault: VaultSnapshot,
    onMark: () -> Unit,
    onAccount: () -> Unit,
) {
    Row(
        modifier =
        Modifier
            .fillMaxWidth()
            .padding(horizontal = ScreenGutter, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
            Modifier
                .size(48.dp)
                .clip(CircleShape)
                .clickable(role = Role.Button, onClick = onMark)
                .testTag("brand_mark"),
            contentAlignment = Alignment.Center,
        ) {
            LuminaraMark(size = 38.dp)
        }
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = "Luminara", style = LuminaraTextStyles.HeadlineSerif.copy(fontSize = 19.sp))
        Spacer(modifier = Modifier.weight(1f))
        quotaLabel(quota)?.let { label ->
            Row(
                modifier =
                Modifier
                    .background(LuminaraColors.Paper3, CircleShape)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    modifier =
                    Modifier
                        .size(6.dp)
                        .background(LuminaraColors.GoldAccent, CircleShape),
                )
                Text(
                    text = label,
                    style = LuminaraTextStyles.EyebrowMono.copy(color = LuminaraColors.GoldLight),
                    modifier = Modifier.testTag("quota_pill"),
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
        }
        Box(
            modifier =
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(LuminaraColors.Paper3)
                .border(1.dp, LuminaraColors.GoldRule, CircleShape)
                .clickable(role = Role.Button, onClick = onAccount)
                .semantics { contentDescription = "Account and settings" }
                .testTag("nav_tab_settings"),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = vault.email.firstOrNull()?.uppercase() ?: "G",
                style = LuminaraTextStyles.SectionTitle.copy(color = LuminaraColors.GoldLight),
            )
        }
    }
}

private fun quotaLabel(quota: QuotaStatus?): String? =
    when {
        quota == null || quota.isUnlimited -> null
        else -> "${quota.remaining} of ${quota.limit} left"
    }

@Composable
private fun Dock(
    selected: LuminaraTab?,
    onSelect: (LuminaraTab) -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    Row(
        modifier =
        Modifier
            .fillMaxWidth()
            .background(LuminaraColors.Paper.copy(alpha = 0.92f))
            .windowInsetsPadding(WindowInsets.navigationBars)
            .height(64.dp)
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LuminaraTab.entries.forEach { tab ->
            val active = tab == selected
            val tint = if (active) LuminaraColors.GoldAccent else LuminaraColors.Ink3
            Column(
                modifier =
                Modifier
                    .weight(1f)
                    .height(56.dp)
                    .clip(CircleShape)
                    .clickable(role = Role.Tab) {
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        onSelect(tab)
                    }.testTag(tab.tag),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Box(
                    modifier =
                    Modifier
                        .size(4.dp)
                        .background(if (active) LuminaraColors.GoldAccent else Color.Transparent, CircleShape),
                )
                Spacer(modifier = Modifier.height(4.dp))
                Icon(tab.icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
                Text(
                    text = tab.label,
                    style = LuminaraTextStyles.EyebrowMono.copy(fontSize = 10.sp, letterSpacing = 0.2.sp, color = tint),
                )
            }
        }
    }
}
