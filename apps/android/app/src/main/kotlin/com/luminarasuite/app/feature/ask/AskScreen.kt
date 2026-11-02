package com.luminarasuite.app.feature.ask

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.AccentHeadline
import com.luminarasuite.app.core.designsystem.AiEvidenceDisclosureBar
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.GhostPillButton
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraOrb
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.PromptBar
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.OracleTurn
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.core.network.OracleEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private val STARTERS =
    listOf(
        "Audit my website",
        "Where do I show up in AI answers?",
        "What is missing on my site?",
        "How should I structure /llms.txt?",
    )

data class AskUiState(
    val promptInput: String = "",
    val isLoading: Boolean = false,
    val statusLine: String? = null,
    val pendingQuestion: String? = null,
    val partialAnswer: String = "",
    val errorMessage: String? = null,
    val turns: List<OracleTurn> = emptyList(),
)

class AskViewModel(
    private val repository: LuminaraRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(AskUiState())
    val uiState: StateFlow<AskUiState> = _uiState.asStateFlow()

    fun updatePrompt(value: String) {
        _uiState.update { it.copy(promptInput = value, errorMessage = null) }
    }

    fun submitQuestion(overridePrompt: String? = null) {
        val question = (overridePrompt ?: _uiState.value.promptInput).trim()
        if (question.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "Enter an SEO, AEO, or GEO question.") }
            return
        }
        val earlier = _uiState.value.turns
        _uiState.update {
            it.copy(
                promptInput = "",
                isLoading = true,
                errorMessage = null,
                pendingQuestion = question,
                partialAnswer = "",
                statusLine = null,
            )
        }
        viewModelScope.launch {
            repository.streamOracle(question, earlier)
                .catch { err ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            pendingQuestion = null,
                            errorMessage =
                            err.message ?: "That did not go through. Sign in or add a Groq key in Settings.",
                        )
                    }
                }.collect { event ->
                    when (event) {
                        is OracleEvent.Status -> _uiState.update { it.copy(statusLine = event.text) }
                        is OracleEvent.Partial -> _uiState.update { it.copy(partialAnswer = event.text) }
                        is OracleEvent.Complete ->
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    pendingQuestion = null,
                                    partialAnswer = "",
                                    statusLine = null,
                                    turns = listOf(event.turn) + it.turns,
                                )
                            }
                    }
                }
        }
    }

    fun reportTurn(turnId: String) {
        viewModelScope.launch {
            repository.reportOracleTurn(turnId)
            _uiState.update { current ->
                current.copy(
                    turns =
                    current.turns.map { turn ->
                        if (turn.id == turnId) turn.copy(isReported = true) else turn
                    },
                )
            }
        }
    }
}

@Composable
fun AskScreen(
    viewModel: AskViewModel,
    seedPrompt: String? = null,
    onSeedConsumed: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val scrollState = rememberScrollState()

    LaunchedEffect(seedPrompt) {
        if (!seedPrompt.isNullOrBlank()) {
            viewModel.updatePrompt(seedPrompt)
            onSeedConsumed()
        }
    }
    LaunchedEffect(state.turns.size, state.pendingQuestion) {
        if (state.pendingQuestion != null || state.turns.size > 1) {
            scrollState.animateScrollTo(scrollState.maxValue)
        } else if (state.turns.size == 1) {
            scrollState.animateScrollTo(0)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier =
            Modifier
                .weight(1f)
                .verticalScroll(scrollState)
                .padding(horizontal = ScreenGutter, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (state.turns.isEmpty() && state.pendingQuestion == null) {
                AskIntro(enabled = !state.isLoading, onStarter = viewModel::submitQuestion)
            }
            state.turns.reversed().forEach { turn ->
                UserBubble(turn.question)
                TurnPlate(turn = turn, onReport = { viewModel.reportTurn(turn.id) })
            }
            state.pendingQuestion?.let { question ->
                UserBubble(question)
                LiveReply(status = state.statusLine, partial = state.partialAnswer)
            }
            state.errorMessage?.let { errorMsg ->
                WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                    Text(text = errorMsg, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
                    if (errorMsg.contains("Settings")) {
                        GhostPillButton(text = "Open Settings", onClick = onOpenSettings)
                    }
                }
            }
            AiEvidenceDisclosureBar(
                note = "AI output can be wrong. Report AI output flags a reply for review.",
            )
            Spacer(modifier = Modifier.height(4.dp))
        }
        PromptBar(
            value = state.promptInput,
            onValueChange = viewModel::updatePrompt,
            placeholder = "Ask about your visibility",
            onSend = { viewModel.submitQuestion() },
            busy = state.isLoading,
            modifier = Modifier.padding(horizontal = ScreenGutter, vertical = 8.dp),
            inputTag = "ask_prompt_input",
            sendTag = "ask_submit_button",
        )
    }
}

@Composable
private fun AskIntro(
    enabled: Boolean,
    onStarter: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(modifier = Modifier.height(12.dp))
        LuminaraOrb(size = 168.dp, thinking = false)
        AccentHeadline(lead = "Ask ", accent = "Luminara")
        Text(
            text = "One verdict, one next action, and live sources when search returns them.",
            style = LuminaraTextStyles.Body.copy(textAlign = TextAlign.Center),
        )
        Spacer(modifier = Modifier.height(4.dp))
        STARTERS.forEach { starter ->
            GhostPillButton(
                text = starter,
                onClick = { onStarter(starter) },
                enabled = enabled,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun UserBubble(text: String) {
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            text = text,
            style = LuminaraTextStyles.Body.copy(color = LuminaraColors.Ink),
            modifier =
            Modifier
                .background(LuminaraColors.Paper3, RoundedCornerShape(20.dp, 20.dp, 4.dp, 20.dp))
                .padding(horizontal = 16.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun LiveReply(
    status: String?,
    partial: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        LuminaraOrb(size = 44.dp, thinking = true)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            status?.let { EyebrowKicker(it) }
            if (partial.isNotBlank()) {
                Text(text = partial, style = LuminaraTextStyles.SectionTitle)
            }
        }
    }
}

@Composable
private fun TurnPlate(
    turn: OracleTurn,
    onReport: () -> Unit,
) {
    WorkbenchCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            EyebrowKicker("Verdict")
            MeasurementStatusBadge(turn.measurementStatus)
        }
        Text(text = turn.verdict, style = LuminaraTextStyles.HeadlineSerif.copy(fontSize = 19.sp, lineHeight = 26.sp))
        EyebrowKicker("Your next move")
        Text(text = turn.nextAction, style = LuminaraTextStyles.Body.copy(color = LuminaraColors.GoldLight))
        if (turn.sources.isEmpty()) {
            Text(
                text = "No live sources. Search evidence is not measured.",
                style = LuminaraTextStyles.Body.copy(fontSize = 12.sp, color = LuminaraColors.Ink3),
            )
        } else {
            EyebrowKicker("Sources ${turn.sources.size}")
            turn.sources.forEachIndexed { index, src ->
                Text(
                    text = "[${index + 1}] ${src.title}",
                    style = LuminaraTextStyles.Body.copy(fontSize = 12.sp),
                    maxLines = 1,
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = turn.modelLabel,
                style = LuminaraTextStyles.Body.copy(fontSize = 11.sp, color = LuminaraColors.Ink3),
            )
            TextButton(onClick = onReport, enabled = !turn.isReported) {
                Text(
                    text = if (turn.isReported) "Reported" else "Report AI output",
                    color = LuminaraColors.Ink2,
                    fontSize = 12.sp,
                )
            }
        }
    }
}
