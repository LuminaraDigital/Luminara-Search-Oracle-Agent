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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.AuditFinding
import com.luminarasuite.app.core.model.AuditHistoryEntry
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
            started = SharingStarted.WhileSubscribed(5_000),
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

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                EyebrowKicker("OPERATOR WORKBENCH · OFFLINE-FIRST")
                Text(text = "Dashboard", style = LuminaraTextStyles.DisplaySerif)
            }
            OutlinedButton(
                onClick = viewModel::syncFromCloud,
                enabled = !state.isRefreshing,
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.testTag("dashboard_sync_button"),
            ) {
                Text(if (state.isRefreshing) "Syncing..." else "Sync Cloud")
            }
        }

        state.syncMessage?.let { msg ->
            WorkbenchCard {
                Text(text = msg, style = LuminaraTextStyles.Body)
            }
        }

        WorkbenchCard(emphasized = true) {
            EyebrowKicker("WEEKLY FINDINGS ACTION BOARD (${state.findings.count { it.status != "done" }} OPEN)")
            if (state.findings.isEmpty()) {
                Text(
                    text = "No open findings yet. Run an Instant Audit to populate your action board.",
                    style = LuminaraTextStyles.Body,
                )
            } else {
                state.findings.forEach { finding ->
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = "${finding.domain} · ${finding.title}",
                                style = LuminaraTextStyles.SectionTitle,
                            )
                            MeasurementStatusBadge(finding.status)
                        }
                        Text(text = finding.description, style = LuminaraTextStyles.Body)
                        OutlinedButton(
                            onClick = { viewModel.cycleFindingStatus(finding) },
                            shape = RoundedCornerShape(999.dp),
                        ) {
                            Text("Mark Status (${finding.status.uppercase()})")
                        }
                    }
                }
            }
        }

        WorkbenchCard {
            EyebrowKicker("DURABLE AUDIT HISTORY (${state.history.size})")
            if (state.history.isEmpty()) {
                Text(
                    text = "Audits you run are cached locally in Room 3 and synced to your workspace when signed in.",
                    style = LuminaraTextStyles.Body,
                )
            } else {
                state.history.forEach { item ->
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(text = item.title, style = LuminaraTextStyles.SectionTitle)
                            if (item.healthScore != null) {
                                Text(
                                    text = "${item.healthScore}/100",
                                    style = LuminaraTextStyles.MetricTabular,
                                )
                            } else {
                                MeasurementStatusBadge("not_measured")
                            }
                        }
                        Text(text = item.summary, style = LuminaraTextStyles.Body)
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                text = "Citation Rate: ${item.citationRatePercent?.let { "$it%" } ?: "not_measured"}",
                                style = LuminaraTextStyles.Body,
                            )
                            Text(
                                text = "Gaps: ${item.schemaGapCount?.toString() ?: "not_measured"}",
                                style = LuminaraTextStyles.Body,
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}
