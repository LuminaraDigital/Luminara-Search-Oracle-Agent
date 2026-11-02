package com.luminarasuite.app.feature.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Radar
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.AccentHeadline
import com.luminarasuite.app.core.designsystem.DoorRow
import com.luminarasuite.app.core.designsystem.EmptyStateCard
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.GhostPillButton
import com.luminarasuite.app.core.designsystem.LiveEyebrow
import com.luminarasuite.app.core.designsystem.LiveTrack
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.ProgressRing
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.SectionHeader
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.designsystem.toneColor
import com.luminarasuite.app.core.designsystem.toneForStatus
import com.luminarasuite.app.core.model.AuditFinding
import com.luminarasuite.app.core.model.AuditHistoryEntry
import com.luminarasuite.app.core.model.fixesShipped
import com.luminarasuite.app.core.network.LuminaraRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class DashboardUiState(
    val isRefreshing: Boolean = false,
    val history: List<AuditHistoryEntry> = emptyList(),
    val findings: List<AuditFinding> = emptyList(),
    val syncMessage: String? = null,
)

class DashboardViewModel(
    private val repository: LuminaraRepository,
) : ViewModel() {
    private val refreshing = MutableStateFlow(false)
    private val syncMessage = MutableStateFlow<String?>(null)

    val uiState: StateFlow<DashboardUiState> =
        combine(
            refreshing,
            repository.auditHistoryFlow,
            repository.findingsFlow,
            syncMessage,
        ) { isRefreshing, history, findings, msg ->
            DashboardUiState(
                isRefreshing = isRefreshing,
                history = history,
                findings = findings,
                syncMessage = msg,
            )
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.Eagerly,
            initialValue = DashboardUiState(),
        )

    fun syncFromCloud() {
        refreshing.value = true
        syncMessage.value = null
        viewModelScope.launch {
            repository.refreshDashboard()
                .onSuccess {
                    refreshing.value = false
                    syncMessage.value = "Workspace synced."
                }
                .onFailure { err ->
                    refreshing.value = false
                    syncMessage.value = err.message ?: "Offline. Showing what is saved on this phone."
                }
        }
    }

    fun cycleFindingStatus(finding: AuditFinding) {
        val nextStatus =
            when (finding.status) {
                "open" -> "in_progress"
                "in_progress" -> "done"
                else -> "open"
            }
        viewModelScope.launch {
            repository.updateFindingStatus(finding.id, nextStatus)
        }
    }
}

@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel,
    isSignedIn: Boolean = false,
    onRunAudit: (String?) -> Unit = {},
    onAskAbout: (String) -> Unit = {},
    onOpenMemory: () -> Unit = {},
    onOpenScout: () -> Unit = {},
    onOpenStudio: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val latest = state.history.firstOrNull()

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = ScreenGutter, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (latest == null) {
            FirstRunHero(onRunAudit = { onRunAudit(null) })
        } else {
            VisibilityHero(
                latest = latest,
                findings = state.findings,
                onRecheck = { onRunAudit(latest.domain) },
            )
            FixQueue(
                findings = state.findings.filter { it.domain == latest.domain && it.status != "done" }.take(3),
                signedIn = isSignedIn,
                onAdvance = viewModel::cycleFindingStatus,
                onAsk = { finding ->
                    onAskAbout("How do I fix this on ${finding.domain}: ${finding.title}? ${finding.description}")
                },
                onSignIn = onOpenSettings,
            )
        }

        if (!isSignedIn) {
            DoorRow(
                title = "Keep this across devices",
                subtitle = "Sign in for 3 audits and 10 questions a day. Your plan syncs with this account.",
                icon = Icons.Outlined.PersonAdd,
                onClick = onOpenSettings,
            )
        }

        SectionHeader(title = "Your workspace")
        DoorRow(
            title = "Brand memory",
            subtitle = "What changed, saved reports, and your timeline.",
            icon = Icons.Outlined.History,
            onClick = onOpenMemory,
            testTag = "home_memory_door",
        )
        DoorRow(
            title = "Idea Scout",
            subtitle = "Turn an idea into a hypothesis before you build a page.",
            icon = Icons.Outlined.Explore,
            onClick = onOpenScout,
        )
        DoorRow(
            title = "Studio",
            subtitle = "Ask your sources, or listen to a two-host briefing.",
            icon = Icons.Outlined.Headphones,
            onClick = onOpenStudio,
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = state.syncMessage ?: if (isSignedIn) "Saved here and synced." else "Saved on this phone.",
                style = LuminaraTextStyles.Body.copy(fontSize = 12.sp),
                modifier = Modifier.weight(1f),
            )
            GhostPillButton(
                text = if (state.isRefreshing) "Syncing" else "Sync",
                onClick = viewModel::syncFromCloud,
                enabled = !state.isRefreshing,
                icon = Icons.Outlined.Sync,
                testTag = "dashboard_sync_button",
            )
        }
        if (state.isRefreshing) LiveTrack()
        Spacer(modifier = Modifier.height(8.dp))
    }
}

@Composable
private fun FirstRunHero(onRunAudit: () -> Unit) {
    LiveEyebrow("Your AI visibility")
    AccentHeadline(lead = "Will AI mention ", accent = "your brand", trail = "?")
    EmptyStateCard(
        title = "Nothing measured yet",
        body = "Run your first check. Your fixes, what changed, and your weekly next move will live here.",
        icon = Icons.Outlined.Radar,
        action = "Run Instant Audit",
        onAction = onRunAudit,
    )
}

@Composable
private fun VisibilityHero(
    latest: AuditHistoryEntry,
    findings: List<AuditFinding>,
    onRecheck: () -> Unit,
) {
    val shipped = fixesShipped(findings, latest.domain)
    LiveEyebrow("Your AI visibility")
    Text(text = latest.domain, style = LuminaraTextStyles.DisplaySerif.copy(fontSize = 28.sp, lineHeight = 34.sp))
    WorkbenchCard(emphasized = true) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            if (shipped != null) {
                ProgressRing(
                    fraction = shipped.first.toFloat() / shipped.second,
                    label = "${shipped.first}/${shipped.second}",
                )
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = if (shipped != null) "Fixes shipped" else "No open gaps",
                    style = LuminaraTextStyles.SectionTitle,
                )
                Text(text = latest.summary, style = LuminaraTextStyles.Body)
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text = "AI citation rate", style = LuminaraTextStyles.Body)
            val rate = latest.citationRatePercent
            if (rate != null) {
                Text(text = "$rate%", style = LuminaraTextStyles.MetricTabular)
            } else {
                MeasurementStatusBadge("not_measured")
            }
        }
        FoundryButton(text = "Re-check ${latest.domain}", onClick = onRecheck)
    }
}

@Composable
private fun FixQueue(
    findings: List<AuditFinding>,
    signedIn: Boolean,
    onAdvance: (AuditFinding) -> Unit,
    onAsk: (AuditFinding) -> Unit,
    onSignIn: () -> Unit,
) {
    SectionHeader(
        title = "Next fix",
        trailing = if (findings.isEmpty()) null else "${findings.size} in queue",
    )
    if (findings.isEmpty()) {
        WorkbenchCard {
            Text(text = "Queue clear", style = LuminaraTextStyles.SectionTitle)
            Text(
                text = "Every fix on this site is marked done. Re-check to confirm it live.",
                style = LuminaraTextStyles.Body,
            )
        }
        return
    }
    findings.forEach { finding ->
        WorkbenchCard(railColor = toneColor(toneForStatus(finding.status))) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = finding.title,
                    style = LuminaraTextStyles.SectionTitle,
                    modifier = Modifier.weight(1f),
                )
                MeasurementStatusBadge(finding.status)
            }
            Text(text = finding.description, style = LuminaraTextStyles.Body, maxLines = 3)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostPillButton(
                    text = if (finding.status == "open") "Start" else "Mark done",
                    onClick = { onAdvance(finding) },
                    modifier = Modifier.weight(1f),
                )
                GhostPillButton(
                    text = if (signedIn) "How to fix" else "Sign in",
                    onClick = { if (signedIn) onAsk(finding) else onSignIn() },
                    modifier = Modifier.weight(1f),
                    testTag = "home_how_to_fix",
                )
            }
        }
    }
}

@Composable
fun AuditTimelineRow(item: AuditHistoryEntry) {
    WorkbenchCard {
        Text(text = item.domain, style = LuminaraTextStyles.SectionTitle)
        Text(text = item.summary, style = LuminaraTextStyles.Body)
        Text(
            text = "${java.time.Instant.ofEpochMilli(
                item.measuredAt,
            ).atZone(java.time.ZoneId.systemDefault()).toLocalDate()}",
            style = LuminaraTextStyles.Body.copy(fontSize = 12.sp, color = LuminaraColors.Ink3),
        )
    }
}
