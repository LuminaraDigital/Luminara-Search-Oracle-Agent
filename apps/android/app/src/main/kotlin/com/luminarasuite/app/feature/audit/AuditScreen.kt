package com.luminarasuite.app.feature.audit

import android.content.Context
import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.AccentHeadline
import com.luminarasuite.app.core.designsystem.AiEvidenceDisclosureBar
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.FoundryFieldColors
import com.luminarasuite.app.core.designsystem.GhostPillButton
import com.luminarasuite.app.core.designsystem.LiveEyebrow
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.PillChip
import com.luminarasuite.app.core.designsystem.ProbeTone
import com.luminarasuite.app.core.designsystem.ProbeWell
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.designsystem.auditIsClear
import com.luminarasuite.app.core.designsystem.botAllowanceLabel
import com.luminarasuite.app.core.designsystem.probeBeacons
import com.luminarasuite.app.core.designsystem.probeCaption
import com.luminarasuite.app.core.designsystem.toneColor
import com.luminarasuite.app.core.designsystem.toneForStatus
import com.luminarasuite.app.core.model.BotDirectiveStatus
import com.luminarasuite.app.core.model.ReadinessCheck
import com.luminarasuite.app.core.network.AuditRead
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
    val isExplaining: Boolean = false,
    val aiRead: AuditRead? = null,
    val savedToStudio: Boolean = false,
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
                aiRead = null,
                savedToStudio = false,
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

    fun explainReport() {
        val currentReport = _uiState.value.report ?: return
        _uiState.update { it.copy(isExplaining = true, errorMessage = null) }
        viewModelScope.launch {
            repository.explainAudit(currentReport)
                .onSuccess { read -> _uiState.update { it.copy(isExplaining = false, aiRead = read) } }
                .onFailure { err ->
                    _uiState.update { it.copy(isExplaining = false, errorMessage = err.message) }
                }
        }
    }

    fun sendToStudio() {
        val currentReport = _uiState.value.report ?: return
        viewModelScope.launch {
            repository.addStudioSource(
                title = "Audit: ${currentReport.domain}",
                content = reportAsText(currentReport),
                kind = "audit",
            )
            _uiState.update { it.copy(savedToStudio = true) }
        }
    }

    fun reportAuditVerdict() {
        val currentReport = _uiState.value.report ?: return
        viewModelScope.launch {
            repository.reportOracleTurn("audit-${currentReport.domain}")
            _uiState.update { it.copy(isVerdictReported = true) }
        }
    }

    fun prepareAnotherProbe() {
        _uiState.update {
            it.copy(
                report = null,
                recheckBanner = null,
                isVerdictReported = false,
                errorMessage = null,
                aiRead = null,
                savedToStudio = false,
            )
        }
    }
}

private fun reportAsText(report: InstantAuditReport): String =
    buildString {
        appendLine("Luminara check of ${report.domain}")
        appendLine(report.verdict)
        report.evaluation.checks.forEach { appendLine("- ${it.label}: ${it.status}. ${it.detail}") }
        appendLine("This week: ${report.oneMoveThisWeek}")
    }

private fun shareReport(
    context: Context,
    report: InstantAuditReport,
) {
    val send =
        Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, "AI visibility check: ${report.domain}")
            .putExtra(Intent.EXTRA_TEXT, reportAsText(report))
    context.startActivity(Intent.createChooser(send, "Share report"))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AuditScreen(
    viewModel: AuditViewModel,
    onAskAbout: (String) -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val scrollState = rememberScrollState()
    val scope = rememberCoroutineScope()
    val beacons = probeBeacons(state.isLoading, state.report?.evaluation?.checks)
    val showReport = state.report != null && !state.isLoading

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = ScreenGutter, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        LiveEyebrow("Instant Audit")
        AccentHeadline(lead = "Will AI mention ", accent = "your brand", trail = "?")
        Text(
            text = "Paste your site. Get a plain answer, the evidence behind it, and one thing to fix this week.",
            style = LuminaraTextStyles.Body,
        )

        WorkbenchCard(emphasized = true) {
            OutlinedTextField(
                value = state.domainInput,
                onValueChange = viewModel::updateDomainInput,
                placeholder = { Text("yoursite.com", color = LuminaraColors.Ink3) },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { viewModel.runAudit() }),
                colors = FoundryFieldColors(),
                modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag("audit_domain_input"),
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("luminarasuite.com", "cloudflare.com").forEach { preset ->
                    PillChip(
                        text = preset,
                        selected = false,
                        onClick = { if (!state.isLoading) viewModel.runAudit(preset) },
                    )
                }
            }
            FoundryButton(
                text = if (state.isLoading) "Reading live files" else "Run Instant Audit",
                onClick = { viewModel.runAudit() },
                enabled = !state.isLoading,
                testTag = "run_audit_button",
            )
        }

        if (state.isLoading || state.report != null) {
            ProbeWell(
                beacons = beacons,
                running = state.isLoading,
                caption = probeCaption(state.isLoading, beacons),
            )
        }

        state.errorMessage?.let { errorMsg ->
            WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                EyebrowKicker("Could not read that site")
                Text(text = errorMsg, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }

        state.recheckBanner?.let { banner ->
            WorkbenchCard {
                EyebrowKicker("Live recheck")
                Text(text = banner, style = LuminaraTextStyles.Body)
            }
        }

        AnimatedVisibility(visible = showReport, modifier = Modifier.fillMaxWidth()) {
            val report = state.report
            if (report != null) {
                AuditReportContent(
                    report = report,
                    state = state,
                    onExplain = viewModel::explainReport,
                    onSendToStudio = viewModel::sendToStudio,
                    isVerdictReported = state.isVerdictReported,
                    onRecheck = viewModel::recheckCheck,
                    onReportVerdict = viewModel::reportAuditVerdict,
                    onAskAbout = onAskAbout,
                    onProbeAnother = {
                        viewModel.prepareAnotherProbe()
                        scope.launch { scrollState.animateScrollTo(0) }
                    },
                )
            }
        }

        AiEvidenceDisclosureBar()
        Spacer(modifier = Modifier.height(8.dp))
    }
}

@Composable
private fun AuditReportContent(
    report: InstantAuditReport,
    state: AuditUiState,
    onExplain: () -> Unit,
    onSendToStudio: () -> Unit,
    isVerdictReported: Boolean,
    onRecheck: (String) -> Unit,
    onReportVerdict: () -> Unit,
    onAskAbout: (String) -> Unit,
    onProbeAnother: () -> Unit,
) {
    val evaluation = report.evaluation
    val clear =
        auditIsClear(
            measurementStatus = evaluation.measurementStatus,
            checks = evaluation.checks,
            failCount = evaluation.failCount,
        )
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        WorkbenchCard(emphasized = true) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                EyebrowKicker(report.domain)
                MeasurementStatusBadge(evaluation.measurementStatus)
            }
            Text(text = report.verdict, style = LuminaraTextStyles.HeadlineSerif)
            if (report.oneMoveThisWeek.isNotBlank()) {
                EyebrowKicker("One move this week")
                Text(
                    text = report.oneMoveThisWeek,
                    style = LuminaraTextStyles.Body.copy(color = LuminaraColors.GoldLight),
                )
            }
            val aiRead = state.aiRead
            if (aiRead == null) {
                GhostPillButton(
                    text = if (state.isExplaining) "Reading" else "Explain in plain English (1 check)",
                    onClick = onExplain,
                    enabled = !state.isExplaining,
                    testTag = "audit_explain_button",
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                EyebrowKicker("Plain English")
                Text(text = aiRead.verdict, style = LuminaraTextStyles.Body.copy(color = LuminaraColors.Ink))
                Text(text = aiRead.nextAction, style = LuminaraTextStyles.Body)
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text = "Health score", style = LuminaraTextStyles.Body)
                if (report.healthScore != null) {
                    Text(text = "${report.healthScore}/100", style = LuminaraTextStyles.MetricTabular)
                } else {
                    MeasurementStatusBadge("not_measured")
                }
            }
            if (report.receiptNote.isNotBlank()) {
                Text(text = report.receiptNote, style = LuminaraTextStyles.Body)
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(
                    onClick = onReportVerdict,
                    enabled = !isVerdictReported,
                    modifier = Modifier.testTag("report_audit_button"),
                ) {
                    Text(
                        text = if (isVerdictReported) "Reported, flagged for review" else "Report AI output",
                        color = if (isVerdictReported) LuminaraColors.GoldLight else LuminaraColors.Ink2,
                    )
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GhostPillButton(
                text = "Share",
                onClick = { shareReport(context, report) },
                modifier = Modifier.weight(1f),
                testTag = "audit_share_button",
            )
            GhostPillButton(
                text = if (state.savedToStudio) "In Studio" else "Send to Studio",
                onClick = onSendToStudio,
                enabled = !state.savedToStudio,
                modifier = Modifier.weight(1f),
                testTag = "audit_studio_button",
            )
        }

        if (clear) {
            WorkbenchCard(emphasized = true, railColor = LuminaraColors.PassGreen) {
                EyebrowKicker("Clear on measured files")
                Text(
                    text = "Ask what to publish next, or probe another host.",
                    style = LuminaraTextStyles.Body,
                )
                FoundryButton(
                    text = "Ask what to publish next",
                    onClick = {
                        onAskAbout(
                            "What should ${report.domain} publish next in /llms.txt so AI crawlers can cite it?",
                        )
                    },
                )
                TextButton(onClick = onProbeAnother, modifier = Modifier.fillMaxWidth()) {
                    Text(text = "Probe another host", color = LuminaraColors.Ink2)
                }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                EyebrowKicker("Crawler files")
                if (evaluation.measurementStatus == "measured") {
                    val countColor =
                        if (evaluation.failCount > 0) LuminaraColors.WarnAmber else LuminaraColors.PassGreen
                    Text(
                        text = "${evaluation.passCount}/${evaluation.checks.size} pass",
                        style = LuminaraTextStyles.MetricTabular.copy(color = countColor),
                    )
                } else {
                    MeasurementStatusBadge("not_measured")
                }
            }
            evaluation.checks.forEach { check ->
                CheckPlate(check = check, onRecheck = onRecheck)
            }
        }

        WorkbenchCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                EyebrowKicker("Robots.txt directives")
                Text(
                    text = botAllowanceLabel(evaluation.botMatrix),
                    style = LuminaraTextStyles.MetricTabular.copy(fontSize = 12.sp),
                )
            }
            BotField(bots = evaluation.botMatrix)
        }
    }
}

@Composable
private fun CheckPlate(
    check: ReadinessCheck,
    onRecheck: (String) -> Unit,
) {
    WorkbenchCard(railColor = toneColor(toneForStatus(check.status))) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = check.label,
                style = LuminaraTextStyles.SectionTitle,
                modifier = Modifier.weight(1f),
            )
            MeasurementStatusBadge(check.status)
        }
        Text(text = check.detail, style = LuminaraTextStyles.Body)
        if (check.status == "fail") {
            GhostPillButton(
                text = "Recheck live fix",
                onClick = { onRecheck(check.id) },
                testTag = "recheck_${check.id}",
            )
        }
    }
}

@Composable
private fun BotField(bots: List<BotDirectiveStatus>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        bots.chunked(2).forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                row.forEach { bot ->
                    BotCell(bot = bot, modifier = Modifier.weight(1f))
                }
                if (row.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun BotCell(
    bot: BotDirectiveStatus,
    modifier: Modifier,
) {
    val tone = toneForStatus(bot.status)
    val washAlpha = if (tone == ProbeTone.Unknown || tone == ProbeTone.Idle) 0.05f else 0.16f
    val wash = toneColor(tone).copy(alpha = washAlpha)
    Column(
        modifier =
        modifier
            .background(wash, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(text = bot.bot, style = LuminaraTextStyles.SectionTitle.copy(fontSize = 13.sp))
        MeasurementStatusBadge(bot.status)
    }
}
