package com.luminarasuite.app.feature.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.LiveTrack
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.designsystem.toneColor
import com.luminarasuite.app.core.designsystem.toneForStatus
import com.luminarasuite.app.core.model.AuditFinding
import com.luminarasuite.app.core.model.AuditHistoryEntry
import com.luminarasuite.app.core.network.LuminaraRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

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
                    syncMessage.value = "Workspace synced with local Room 3 cache."
                }
                .onFailure { err ->
                    refreshing.value = false
                    syncMessage.value = err.message ?: "Offline mode active: showing local Room 3 history."
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
fun DashboardScreen(viewModel: DashboardViewModel) {
    val state by viewModel.uiState.collectAsState()
    val scrollState = rememberScrollState()
    val openCount = state.findings.count { it.status != "done" }

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                EyebrowKicker("Offline first")
                Text(text = "Action board", style = LuminaraTextStyles.DisplaySerif)
            }
            OutlinedButton(
                onClick = viewModel::syncFromCloud,
                enabled = !state.isRefreshing,
                modifier = Modifier.testTag("dashboard_sync_button"),
            ) {
                Text(if (state.isRefreshing) "Syncing" else "Sync")
            }
        }
        Text(
            text = "Fixes stay on this device. Sync when you are signed in.",
            style = LuminaraTextStyles.Body,
        )
        if (state.isRefreshing) {
            LiveTrack()
        }

        state.syncMessage?.let { msg ->
            WorkbenchCard {
                Text(text = msg, style = LuminaraTextStyles.Body, color = LuminaraColors.Ink)
            }
        }

        EyebrowKicker(if (openCount == 0) "No open fixes" else "$openCount open")
        if (state.findings.isEmpty()) {
            WorkbenchCard {
                Text(
                    text = "No moves yet. Probe a host and the first fix lands here.",
                    style = LuminaraTextStyles.Body,
                )
            }
        } else {
            state.findings.forEach { finding ->
                FindingPlate(
                    finding = finding,
                    onAdvance = { viewModel.cycleFindingStatus(finding) },
                )
            }
        }

        EyebrowKicker("Cached audits ${state.history.size}")
        if (state.history.isEmpty()) {
            WorkbenchCard {
                Text(
                    text = "Audits you run are cached in Room 3 and sync to your workspace when signed in.",
                    style = LuminaraTextStyles.Body,
                )
            }
        } else {
            state.history.forEachIndexed { index, item ->
                HistoryRow(item = item, continueRail = index < state.history.lastIndex)
            }
        }

        Spacer(modifier = Modifier.height(8.dp))
    }
}

@Composable
private fun FindingPlate(
    finding: AuditFinding,
    onAdvance: () -> Unit,
) {
    WorkbenchCard(
        railColor = toneColor(toneForStatus(finding.status)),
        onClick = onAdvance,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "${finding.domain}: ${finding.title}",
                style = LuminaraTextStyles.SectionTitle,
                modifier = Modifier.weight(1f),
            )
            MeasurementStatusBadge(finding.status)
        }
        Text(text = finding.description, style = LuminaraTextStyles.Body)
        Text(
            text = "Tap to advance",
            style = LuminaraTextStyles.Body.copy(fontSize = 12.sp),
        )
    }
}

@Composable
private fun HistoryRow(
    item: AuditHistoryEntry,
    continueRail: Boolean,
) {
    val measuredOn =
        Instant.ofEpochMilli(item.measuredAt)
            .atZone(ZoneId.systemDefault())
            .toLocalDate()
            .toString()
    Row(
        modifier =
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
    ) {
        Column(
            modifier = Modifier.width(18.dp).fillMaxHeight(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier =
                Modifier
                    .padding(top = 6.dp)
                    .width(8.dp)
                    .height(8.dp)
                    .background(LuminaraColors.Ink2, CircleShape),
            )
            if (continueRail) {
                Box(
                    modifier =
                    Modifier
                        .padding(top = 4.dp)
                        .width(1.dp)
                        .weight(1f)
                        .background(Color.White.copy(alpha = 0.12f)),
                )
            }
        }
        Column(
            modifier =
            Modifier
                .weight(1f)
                .padding(start = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text = item.title, style = LuminaraTextStyles.SectionTitle, modifier = Modifier.weight(1f))
                if (item.healthScore != null) {
                    Text(text = "${item.healthScore}/100", style = LuminaraTextStyles.MetricTabular)
                } else {
                    MeasurementStatusBadge("not_measured")
                }
            }
            Text(text = measuredOn, style = LuminaraTextStyles.EyebrowMono.copy(letterSpacing = 0.sp))
            Text(text = item.summary, style = LuminaraTextStyles.Body)
            Text(
                text = "Citation rate: ${item.citationRatePercent?.let { "$it%" } ?: "NOT_MEASURED"}",
                style = LuminaraTextStyles.Body,
            )
            Text(
                text = "Schema gaps: ${item.schemaGapCount?.toString() ?: "NOT_MEASURED"}",
                style = LuminaraTextStyles.Body,
            )
        }
    }
}
