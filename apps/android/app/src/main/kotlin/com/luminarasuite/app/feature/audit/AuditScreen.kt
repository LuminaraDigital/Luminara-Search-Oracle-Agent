package com.luminarasuite.app.feature.audit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.AiEvidenceDisclosureBar
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.network.InstantAuditReport
import com.luminarasuite.app.core.network.LuminaraRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AuditUiState(
    val domainInput: String = "",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val report: InstantAuditReport? = null,
    val recheckBanner: String? = null,
    val isVerdictReported: Boolean = false,
)

class AuditViewModel(
    private val repository: LuminaraRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(AuditUiState())
    val uiState: StateFlow<AuditUiState> = _uiState.asStateFlow()

    fun updateDomainInput(value: String) {
        _uiState.update { it.copy(domainInput = value, errorMessage = null) }
    }

    fun runAudit(overrideDomain: String? = null) {
        val target = (overrideDomain ?: _uiState.value.domainInput).trim()
        if (target.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "Enter a domain such as luminarasuite.com.") }
            return
        }
        _uiState.update {
            it.copy(
                domainInput = target,
                isLoading = true,
                errorMessage = null,
                recheckBanner = null,
                isVerdictReported = false,
            )
        }
        viewModelScope.launch {
            repository.runInstantAudit(target)
                .onSuccess { report ->
                    _uiState.update { it.copy(isLoading = false, report = report, errorMessage = null) }
                }
                .onFailure { err ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = err.message ?: "Live crawl check failed. Check your connection.",
                        )
                    }
                }
        }
    }

    fun recheckCheck(checkId: String) {
        val currentReport = _uiState.value.report ?: return
        viewModelScope.launch {
            repository.recheckSingleCheck(currentReport.domain, checkId)
                .onSuccess { res ->
                    val statusText =
                        when (res.passed) {
                            true -> "PASSED"
                            false -> "STILL FAILING"
                            null -> "NOT MEASURED"
                        }
                    val updatedReport =
                        if (res.passed != null) {
                            val newStatus = if (res.passed) "pass" else "fail"
                            val updatedChecks =
                                currentReport.evaluation.checks.map { check ->
                                    if (check.id == checkId) {
                                        check.copy(
                                            status = newStatus,
                                            detail = res.detail.ifBlank { check.detail },
                                        )
                                    } else {
                                        check
                                    }
                                }
                            val updatedEval =
                                currentReport.evaluation.copy(
                                    checks = updatedChecks,
                                    passCount = updatedChecks.count { it.status == "pass" },
                                    failCount = updatedChecks.count { it.status == "fail" },
                                )
                            currentReport.copy(evaluation = updatedEval)
                        } else {
                            currentReport
                        }
                    val label = res.label.ifBlank { checkId }
                    _uiState.update {
                        it.copy(
                            report = updatedReport,
                            recheckBanner = "Live recheck ($label): $statusText - ${res.detail}",
                        )
                    }
                }
                .onFailure { err ->
                    _uiState.update {
                        it.copy(recheckBanner = "Live recheck unavailable (${err.message ?: "check connection"}).")
                    }
                }
        }
    }

    fun reportAuditVerdict() {
        val currentReport = _uiState.value.report ?: return
        viewModelScope.launch {
            repository.reportOracleTurn("audit-${currentReport.domain}")
            _uiState.update { it.copy(isVerdictReported = true) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AuditScreen(viewModel: AuditViewModel) {
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
        EyebrowKicker("NIGHT FOUNDRY · LIVE CRAWL PROBE")
        Text(
            text = "Verify how AI search engines crawl your domain.",
            style = LuminaraTextStyles.DisplaySerif,
        )
        Text(
            text = "Inspects /robots.txt, /llms.txt, and /ai.txt in real time with zero fabricated scores.",
            style = LuminaraTextStyles.Body,
        )

        WorkbenchCard(emphasized = true) {
            OutlinedTextField(
                value = state.domainInput,
                onValueChange = viewModel::updateDomainInput,
                label = { Text("Target domain (e.g. luminarasuite.com)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("audit_domain_input"),
            )

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("luminarasuite.com", "cloudflare.com", "developer.android.com").forEach { preset ->
                    AssistChip(
                        onClick = { viewModel.runAudit(preset) },
                        label = { Text(preset) },
                    )
                }
            }

            Button(
                onClick = { viewModel.runAudit() },
                enabled = !state.isLoading,
                shape = RoundedCornerShape(999.dp),
                colors =
                ButtonDefaults.buttonColors(
                    containerColor = LuminaraColors.GoldAccent,
                    contentColor = LuminaraColors.AccentInk,
                ),
                modifier = Modifier.fillMaxWidth().height(50.dp).testTag("run_audit_button"),
            ) {
                Text(if (state.isLoading) "Running Live Crawl..." else "Run Instant Audit")
            }
        }

        if (state.isLoading) {
            WorkbenchCard {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    CircularProgressIndicator(color = LuminaraColors.GoldAccent)
                    Text(
                        text = "Inspecting live /robots.txt, /llms.txt, and /ai.txt...",
                        style = LuminaraTextStyles.Body,
                    )
                }
            }
        }

        state.errorMessage?.let { errorMsg ->
            WorkbenchCard {
                EyebrowKicker("AUDIT ERROR")
                Text(text = errorMsg, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }

        state.recheckBanner?.let { banner ->
            WorkbenchCard {
                EyebrowKicker("LIVE FIX RECHECK")
                Text(text = banner, style = LuminaraTextStyles.Body)
            }
        }

        val report = state.report
        if (report == null && !state.isLoading && state.errorMessage == null) {
            WorkbenchCard {
                EyebrowKicker("READY TO AUDIT")
                Text(
                    text = "Select a preset domain above or enter any hostname to inspect its live AI crawler posture.",
                    style = LuminaraTextStyles.Body,
                )
            }
        }

        if (report != null) {
            AuditReportContent(
                report = report,
                isVerdictReported = state.isVerdictReported,
                onRecheck = viewModel::recheckCheck,
                onReportVerdict = viewModel::reportAuditVerdict,
            )
        }

        AiEvidenceDisclosureBar()
        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun AuditReportContent(
    report: InstantAuditReport,
    isVerdictReported: Boolean,
    onRecheck: (String) -> Unit,
    onReportVerdict: () -> Unit,
) {
    WorkbenchCard(emphasized = true) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            EyebrowKicker("VERDICT · ${report.domain}")
            MeasurementStatusBadge(report.evaluation.measurementStatus)
        }
        Text(text = report.verdict, style = LuminaraTextStyles.SectionTitle)
        Text(text = "One move this week: ${report.oneMoveThisWeek}", style = LuminaraTextStyles.Body)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text = "Health Score:", style = LuminaraTextStyles.Body)
            if (report.healthScore != null) {
                Text(text = "${report.healthScore}/100", style = LuminaraTextStyles.MetricTabular)
            } else {
                MeasurementStatusBadge("not_measured")
            }
        }
        Text(text = report.receiptNote, style = LuminaraTextStyles.Body)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(
                onClick = onReportVerdict,
                enabled = !isVerdictReported,
                modifier = Modifier.testTag("report_audit_button"),
            ) {
                Text(
                    text = if (isVerdictReported) "Reported · Flagged for Review" else "Report AI Output",
                    color = if (isVerdictReported) LuminaraColors.GoldLight else LuminaraColors.Ink2,
                )
            }
        }
    }

    WorkbenchCard {
        EyebrowKicker("LLM CRAWLER READINESS (${report.evaluation.passCount}/${report.evaluation.checks.size} PASS)")
        report.evaluation.checks.forEach { check ->
            Column(
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(text = check.label, style = LuminaraTextStyles.SectionTitle)
                    MeasurementStatusBadge(check.status)
                }
                Text(text = check.detail, style = LuminaraTextStyles.Body)
                if (check.status == "fail") {
                    OutlinedButton(
                        onClick = { onRecheck(check.id) },
                        shape = RoundedCornerShape(999.dp),
                        modifier = Modifier.testTag("recheck_${check.id}"),
                    ) {
                        Text("Recheck Live Fix")
                    }
                }
            }
        }
    }

    WorkbenchCard {
        EyebrowKicker("AI BOT GOVERNANCE MATRIX (ROBOTS.TXT)")
        report.evaluation.botMatrix.forEach { botRow ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text = botRow.bot, style = LuminaraTextStyles.Body)
                MeasurementStatusBadge(botRow.status)
            }
        }
    }
}
