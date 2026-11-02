package com.luminarasuite.app.feature.memory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CompareArrows
import androidx.compose.material.icons.outlined.Assessment
import androidx.compose.material.icons.outlined.History
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.luminarasuite.app.core.designsystem.AccentHeadline
import com.luminarasuite.app.core.designsystem.ChipStrip
import com.luminarasuite.app.core.designsystem.EmptyStateCard
import com.luminarasuite.app.core.designsystem.GhostPillButton
import com.luminarasuite.app.core.designsystem.LiveEyebrow
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.PillChip
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.AuditChange
import com.luminarasuite.app.core.model.AuditHistoryEntry
import com.luminarasuite.app.core.model.auditChanges
import com.luminarasuite.app.feature.dashboard.AuditTimelineRow
import com.luminarasuite.app.feature.dashboard.DashboardViewModel

private enum class MemoryTab(
    val label: String,
) {
    CHANGED("What changed"),
    REPORTS("Saved reports"),
    TIMELINE("Timeline"),
}

@Composable
fun MemoryScreen(
    viewModel: DashboardViewModel,
    onRunAudit: () -> Unit,
    onAskAbout: (String) -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    var tab by rememberSaveable { mutableStateOf(MemoryTab.CHANGED) }

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = ScreenGutter, vertical = 8.dp)
            .testTag("memory_screen"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        LiveEyebrow("Brand memory")
        AccentHeadline(lead = "What this workspace ", accent = "remembers")
        Text(
            text = "Audits stay on this phone and sync to your account when you sign in.",
            style = LuminaraTextStyles.Body,
        )
        ChipStrip {
            MemoryTab.entries.forEach { entry ->
                PillChip(text = entry.label, selected = tab == entry, onClick = { tab = entry })
            }
        }
        when (tab) {
            MemoryTab.CHANGED -> ChangedTab(auditChanges(state.history), state.history, onRunAudit)
            MemoryTab.REPORTS -> ReportsTab(state.history, onRunAudit, onAskAbout)
            MemoryTab.TIMELINE -> TimelineTab(state.history, onRunAudit)
        }
        Spacer(modifier = Modifier.height(8.dp))
    }
}

@Composable
private fun ChangedTab(
    changes: List<AuditChange>,
    history: List<AuditHistoryEntry>,
    onRunAudit: () -> Unit,
) {
    if (changes.isEmpty()) {
        EmptyStateCard(
            title = if (history.isEmpty()) "No audits stored yet" else "One more audit to compare",
            body =
            if (history.isEmpty()) {
                "Run an audit to set a baseline. The next one shows what moved."
            } else {
                "This needs two audits of the same site. Re-check after your next fix."
            },
            icon = Icons.AutoMirrored.Outlined.CompareArrows,
            action = "Run Instant Audit",
            onAction = onRunAudit,
        )
        return
    }
    changes.forEach { change ->
        val color =
            when (change.improved) {
                true -> LuminaraColors.PassGreen
                false -> LuminaraColors.WarnAmber
                null -> LuminaraColors.Ink2
            }
        WorkbenchCard(railColor = color) {
            Text(text = change.domain, style = LuminaraTextStyles.EyebrowMono)
            Text(text = change.headline, style = LuminaraTextStyles.HeadlineSerif.copy(color = color))
            Text(text = change.detail, style = LuminaraTextStyles.Body)
        }
    }
}

@Composable
private fun ReportsTab(
    history: List<AuditHistoryEntry>,
    onRunAudit: () -> Unit,
    onAskAbout: (String) -> Unit,
) {
    if (history.isEmpty()) {
        EmptyStateCard(
            title = "No saved reports",
            body = "Every audit you run is saved here.",
            icon = Icons.Outlined.Assessment,
            action = "Run Instant Audit",
            onAction = onRunAudit,
        )
        return
    }
    history.forEach { item ->
        WorkbenchCard {
            Text(text = item.title, style = LuminaraTextStyles.SectionTitle)
            Text(text = item.reportExcerpt, style = LuminaraTextStyles.Body.copy(fontSize = 13.sp))
            GhostPillButton(
                text = "Ask about this report",
                onClick = {
                    onAskAbout("Based on this audit of ${item.domain}, what should I do first? ${item.summary}")
                },
            )
        }
    }
}

@Composable
private fun TimelineTab(
    history: List<AuditHistoryEntry>,
    onRunAudit: () -> Unit,
) {
    if (history.isEmpty()) {
        EmptyStateCard(
            title = "Your timeline starts with one audit",
            body = "Each check adds a dated entry so you can see the work add up.",
            icon = Icons.Outlined.History,
            action = "Run Instant Audit",
            onAction = onRunAudit,
        )
        return
    }
    history.forEach { AuditTimelineRow(it) }
}
