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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import com.luminarasuite.app.core.designsystem.AiEvidenceDisclosureBar
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.WorkbenchCard
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
fun AskScreen(viewModel: AskViewModel) {
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
        EyebrowKicker("ORACLE AGENT · EVIDENCE-BOUND AEO & GEO")
        Text(
            text = "Ask the Search Oracle.",
            style = LuminaraTextStyles.DisplaySerif,
        )
        Text(
            text = "Returns a concise verdict, one next action, and grounded web sources.",
            style = LuminaraTextStyles.Body,
        )

        WorkbenchCard(emphasized = true) {
            OutlinedTextField(
                value = state.promptInput,
                onValueChange = viewModel::updatePrompt,
                label = { Text("Ask about llms.txt, schema.org, or AI citations") },
                modifier = Modifier.fillMaxWidth().testTag("ask_prompt_input"),
            )

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(
                    "How should I structure /llms.txt for AI crawlers?",
                    "Which schema.org types improve Perplexity and ChatGPT citations?",
                ).forEach { starter ->
                    AssistChip(
                        onClick = { viewModel.submitQuestion(starter) },
                        label = { Text(starter) },
                    )
                }
            }

            Button(
                onClick = { viewModel.submitQuestion() },
                enabled = !state.isLoading,
                shape = RoundedCornerShape(999.dp),
                colors =
                ButtonDefaults.buttonColors(
                    containerColor = LuminaraColors.GoldAccent,
                    contentColor = LuminaraColors.AccentInk,
                ),
                modifier = Modifier.fillMaxWidth().height(50.dp).testTag("ask_submit_button"),
            ) {
                Text(if (state.isLoading) "Consulting Oracle..." else "Ask Oracle")
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
                        text = "Grounding live search results and synthesizing verdict...",
                        style = LuminaraTextStyles.Body,
                    )
                }
            }
        }

        state.errorMessage?.let { errorMsg ->
            WorkbenchCard {
                EyebrowKicker("ORACLE NOTICE")
                Text(text = errorMsg, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }

        if (state.turns.isEmpty() && !state.isLoading) {
            WorkbenchCard {
                EyebrowKicker("NO TURNS YET")
                Text(
                    text = "Sign in or configure your own Groq / Tavily API keys in Settings to query the Oracle.",
                    style = LuminaraTextStyles.Body,
                )
            }
        }

        state.turns.forEach { turn ->
            WorkbenchCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    EyebrowKicker(turn.modelLabel)
                    MeasurementStatusBadge(turn.measurementStatus)
                }
                Text(text = "Q: ${turn.question}", style = LuminaraTextStyles.Body)
                Text(text = "Verdict: ${turn.verdict}", style = LuminaraTextStyles.SectionTitle)
                Text(text = "Next Action: ${turn.nextAction}", style = LuminaraTextStyles.Body)

                if (turn.sources.isNotEmpty()) {
                    EyebrowKicker("GROUNDED SOURCES (${turn.sources.size})")
                    turn.sources.forEach { src ->
                        Text(text = "• ${src.title}: ${src.url}", style = LuminaraTextStyles.Body)
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    OutlinedButton(
                        onClick = { viewModel.reportTurn(turn.id) },
                        enabled = !turn.isReported,
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Text(if (turn.isReported) "Reported for Review" else "Report AI Output")
                    }
                }
            }
        }

        AiEvidenceDisclosureBar(
            note = "AI-generated outputs may contain inaccuracies. Use Report AI Output to flag any response.",
        )
        Spacer(modifier = Modifier.height(16.dp))
    }
}
