package com.luminarasuite.app.feature.ask

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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.AiEvidenceDisclosureBar
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.FoundryFieldColors
import com.luminarasuite.app.core.designsystem.LiveTrack
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.designsystem.toneColor
import com.luminarasuite.app.core.designsystem.toneForStatus
import com.luminarasuite.app.core.model.OracleTurn
import com.luminarasuite.app.core.network.LuminaraRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AskUiState(
    val promptInput: String = "",
    val isLoading: Boolean = false,
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
        _uiState.update { it.copy(promptInput = "", isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            repository.askOracle(question)
                .onSuccess { turn ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            turns = listOf(turn) + it.turns,
                            errorMessage = null,
                        )
                    }
                }
                .onFailure { err ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage =
                            err.message
                                ?: "Oracle request failed. Sign in or add a Groq API key in Settings.",
                        )
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AskScreen(
    viewModel: AskViewModel,
    seedPrompt: String? = null,
    onSeedConsumed: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val scrollState = rememberScrollState()

    LaunchedEffect(seedPrompt) {
        if (!seedPrompt.isNullOrBlank()) {
            viewModel.updatePrompt(seedPrompt)
            onSeedConsumed()
        }
    }

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        EyebrowKicker("Search oracle")
        Text(text = "Ask the Search Oracle", style = LuminaraTextStyles.DisplaySerif)
        Text(
            text = "One verdict, one next action, and sources when search returns them.",
            style = LuminaraTextStyles.Body,
        )

        WorkbenchCard(emphasized = true) {
            OutlinedTextField(
                value = state.promptInput,
                onValueChange = viewModel::updatePrompt,
                label = { Text("Ask about llms.txt, schema, or citations") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { viewModel.submitQuestion() }),
                colors = FoundryFieldColors(),
                modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag("ask_prompt_input"),
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf(
                    "How should I structure /llms.txt for AI crawlers?",
                    "Which schema.org types improve Perplexity and ChatGPT citations?",
                ).forEach { starter ->
                    TextButton(
                        onClick = { viewModel.submitQuestion(starter) },
                        enabled = !state.isLoading,
                    ) {
                        Text(
                            text = starter,
                            color = LuminaraColors.Ink2,
                            style = LuminaraTextStyles.Body.copy(fontSize = 13.sp),
                        )
                    }
                }
            }
            FoundryButton(
                text = if (state.isLoading) "Grounding the reply" else "Ask",
                onClick = { viewModel.submitQuestion() },
                enabled = !state.isLoading,
                testTag = "ask_submit_button",
            )
            if (state.isLoading) {
                LiveTrack()
                Text(
                    text = "Grounding the reply. Unverified numbers stay NOT_MEASURED.",
                    style = LuminaraTextStyles.Body,
                )
            }
        }

        state.errorMessage?.let { errorMsg ->
            WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                EyebrowKicker("Oracle notice")
                Text(text = errorMsg, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }

        if (state.turns.isEmpty() && !state.isLoading && state.errorMessage == null) {
            WorkbenchCard {
                EyebrowKicker("No verdict yet")
                Text(
                    text = "Sign in for hosted checks, or add a Groq key in Settings. Then ask one question.",
                    style = LuminaraTextStyles.Body,
                )
            }
        }

        state.turns.forEach { turn ->
            TurnPlate(turn = turn, onReport = { viewModel.reportTurn(turn.id) })
        }

        AiEvidenceDisclosureBar(
            note = "AI output can be wrong. Report AI output flags a reply for review.",
        )
        Spacer(modifier = Modifier.height(8.dp))
    }
}

@Composable
private fun TurnPlate(
    turn: OracleTurn,
    onReport: () -> Unit,
) {
    WorkbenchCard(railColor = toneColor(toneForStatus(turn.measurementStatus))) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            EyebrowKicker(turn.modelLabel)
            MeasurementStatusBadge(turn.measurementStatus)
        }
        Text(text = turn.question, style = LuminaraTextStyles.Body)
        Text(text = turn.verdict, style = LuminaraTextStyles.SectionTitle, color = LuminaraColors.Ink)
        Text(
            text = "Next: ${turn.nextAction}",
            style = LuminaraTextStyles.Body.copy(color = LuminaraColors.GoldLight),
        )
        if (turn.sources.isEmpty()) {
            Text(
                text = "No grounded sources. Search evidence is NOT_MEASURED.",
                style = LuminaraTextStyles.Body,
            )
        } else {
            EyebrowKicker("Sources ${turn.sources.size}")
            turn.sources.forEach { src ->
                Text(text = "${src.title}. ${src.url}", style = LuminaraTextStyles.Body)
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            OutlinedButton(
                onClick = onReport,
                enabled = !turn.isReported,
                shape = RoundedCornerShape(999.dp),
            ) {
                Text(if (turn.isReported) "Reported for review" else "Report AI output")
            }
        }
    }
}
