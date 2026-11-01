package com.luminarasuite.app.feature.scout

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.AccentHeadline
import com.luminarasuite.app.core.designsystem.AiEvidenceDisclosureBar
import com.luminarasuite.app.core.designsystem.ChipStrip
import com.luminarasuite.app.core.designsystem.EmptyStateCard
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.FoundryFieldColors
import com.luminarasuite.app.core.designsystem.GhostPillButton
import com.luminarasuite.app.core.designsystem.LiveEyebrow
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraOrb
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.PillChip
import com.luminarasuite.app.core.designsystem.ReportAiOutput
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.SectionHeader
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.IdeaCard
import com.luminarasuite.app.core.model.IdeaCreateRequest
import com.luminarasuite.app.core.model.IdeaSummary
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.feature.share.ShareActions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val MAX_IDEA_CHARS = 300
private const val MAX_COMPETITORS = 3
private val SUGGESTED_NICHES = listOf("Real estate", "B2B SaaS", "Local services", "Ecommerce", "Wealth advisory")

data class ScoutUiState(
    val idea: String = "",
    val niche: String = "",
    val competitors: String = "",
    val isBuilding: Boolean = false,
    val errorMessage: String? = null,
    val card: IdeaCard? = null,
    val cardsLeft: Int? = null,
    val savedToStudio: Boolean = false,
    val isReported: Boolean = false,
    val drafts: List<IdeaSummary> = emptyList(),
)

class ScoutViewModel(
    private val repository: LuminaraRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(ScoutUiState())
    val uiState: StateFlow<ScoutUiState> = _uiState.asStateFlow()

    fun updateIdea(value: String) =
        _uiState.update { it.copy(idea = value.take(MAX_IDEA_CHARS), errorMessage = null) }

    fun updateNiche(value: String) = _uiState.update { it.copy(niche = value) }

    fun updateCompetitors(value: String) = _uiState.update { it.copy(competitors = value) }

    fun loadDrafts() {
        viewModelScope.launch {
            repository.listIdeas().onSuccess { ideas -> _uiState.update { it.copy(drafts = ideas) } }
        }
    }

    fun buildCard() {
        val state = _uiState.value
        val competitors =
            state.competitors.split(',', '\n', ' ')
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .map { if (it.startsWith("http")) it else "https://$it" }
                .take(MAX_COMPETITORS)
        _uiState.update { it.copy(isBuilding = true, errorMessage = null, card = null, savedToStudio = false) }
        viewModelScope.launch {
            repository.createIdea(
                IdeaCreateRequest(
                    idea = state.idea.trim(),
                    niche = state.niche.trim().ifEmpty { null },
                    competitorUrls = competitors,
                ),
            ).onSuccess { res ->
                _uiState.update {
                    it.copy(isBuilding = false, card = res.card, cardsLeft = res.ideaCardsRemaining)
                }
                loadDrafts()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(isBuilding = false, errorMessage = err.message ?: "That card did not build. Try again.")
                }
            }
        }
    }

    fun openDraft(id: String) {
        _uiState.update { it.copy(isBuilding = true, errorMessage = null, savedToStudio = false) }
        viewModelScope.launch {
            repository.getIdeaCard(id)
                .onSuccess { card -> _uiState.update { it.copy(isBuilding = false, card = card) } }
                .onFailure { err -> _uiState.update { it.copy(isBuilding = false, errorMessage = err.message) } }
        }
    }

    fun reportCard() {
        val card = _uiState.value.card ?: return
        viewModelScope.launch {
            repository.reportOracleTurn("idea-${card.hashCode()}")
            _uiState.update { it.copy(isReported = true) }
        }
    }

    fun sendToStudio() {
        val card = _uiState.value.card ?: return
        viewModelScope.launch {
            repository.addStudioSource(
                title = "Idea: ${card.problem}",
                content = ideaAsSource(card),
                kind = "idea",
            )
            _uiState.update { it.copy(savedToStudio = true) }
        }
    }
}

private fun ideaAsSource(card: IdeaCard): String =
    buildString {
        appendLine("Problem: ${card.problem}")
        appendLine("Who asks AI: ${card.whoAsksAi.persona}")
        card.whoAsksAi.promptPatterns.forEach { appendLine("Prompt pattern: $it") }
        card.contentBets.forEach { appendLine("Hypothesis: ${it.hypothesis}") }
    }

@Composable
fun ScoutScreen(
    viewModel: ScoutViewModel,
    isSignedIn: Boolean,
    onSignIn: () -> Unit,
    onAuditDomain: (String?) -> Unit,
    onShareLink: suspend (String, String?) -> Result<String> = { _, _ ->
        Result.failure(IllegalStateException("Sign in to create a link."))
    },
) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(isSignedIn) { viewModel.loadDrafts() }

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = ScreenGutter, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        LiveEyebrow("Idea Scout")
        AccentHeadline(lead = "Start from an ", accent = "idea")
        Text(
            text =
            "Describe the concept. You get an early hypothesis, not a ranking. " +
                "You get 2 cards a UTC day.",
            style = LuminaraTextStyles.Body,
        )
        if (!isSignedIn) {
            EmptyStateCard(
                title = "Sign in to scout",
                body = "Idea cards are saved to your account. It is free.",
                icon = Icons.Outlined.PersonAdd,
                action = "Sign in",
                onAction = onSignIn,
            )
        } else {
            IdeaForm(state = state, viewModel = viewModel)
        }

        state.errorMessage?.let {
            WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                Text(text = it, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }
        if (state.isBuilding) {
            Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                LuminaraOrb(size = 96.dp, thinking = true)
                Text(text = "Reading competitors and drafting", style = LuminaraTextStyles.Body)
            }
        }
        state.card?.let { card ->
            IdeaCardView(
                card = card,
                savedToStudio = state.savedToStudio,
                isReported = state.isReported,
                onReport = viewModel::reportCard,
                onSendToStudio = viewModel::sendToStudio,
                onAudit = { onAuditDomain(null) },
                onShareLink = onShareLink,
            )
        }
        if (state.drafts.isNotEmpty()) {
            SectionHeader(title = "Drafted hypotheses", trailing = "${state.drafts.size} saved")
            state.drafts.forEach { draft ->
                WorkbenchCard(
                    modifier = Modifier.clickable { viewModel.openDraft(draft.id) },
                ) {
                    draft.niche?.let { EyebrowKicker(it) }
                    Text(text = draft.ideaText, style = LuminaraTextStyles.SectionTitle.copy(fontSize = 15.sp))
                }
            }
        }
        AiEvidenceDisclosureBar(note = "Cards are hypotheses. Nothing here is a measured ranking.")
        Spacer(modifier = Modifier.height(8.dp))
    }
}

@Composable
private fun IdeaForm(
    state: ScoutUiState,
    viewModel: ScoutViewModel,
) {
    WorkbenchCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            EyebrowKicker("Core idea")
            Text(
                text = "${state.idea.length} / $MAX_IDEA_CHARS",
                style = LuminaraTextStyles.MetricTabular.copy(fontSize = 12.sp, color = LuminaraColors.Ink3),
            )
        }
        OutlinedTextField(
            value = state.idea,
            onValueChange = viewModel::updateIdea,
            placeholder = { Text("A suburb page that answers who sells homes here.", color = LuminaraColors.Ink3) },
            shape = RoundedCornerShape(16.dp),
            colors = FoundryFieldColors(),
            modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 112.dp)
                .testTag("scout_idea_input"),
        )
        EyebrowKicker("Niche (optional)")
        OutlinedTextField(
            value = state.niche,
            onValueChange = viewModel::updateNiche,
            singleLine = true,
            shape = RoundedCornerShape(16.dp),
            colors = FoundryFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        ChipStrip {
            SUGGESTED_NICHES.forEach { niche ->
                PillChip(
                    text = niche,
                    selected = state.niche == niche,
                    onClick = { viewModel.updateNiche(niche) },
                )
            }
        }
        EyebrowKicker("Up to $MAX_COMPETITORS competitor sites")
        OutlinedTextField(
            value = state.competitors,
            onValueChange = viewModel::updateCompetitors,
            placeholder = { Text("competitor.com, another.com", color = LuminaraColors.Ink3) },
            shape = RoundedCornerShape(16.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            colors = FoundryFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        FoundryButton(
            text = if (state.isBuilding) "Building" else "Build idea card",
            onClick = viewModel::buildCard,
            enabled = state.idea.isNotBlank() && !state.isBuilding,
            testTag = "scout_build_button",
        )
        state.cardsLeft?.let {
            Text(text = "$it cards left today", style = LuminaraTextStyles.Body.copy(fontSize = 12.sp))
        }
    }
}

@Composable
private fun IdeaCardView(
    card: IdeaCard,
    savedToStudio: Boolean,
    isReported: Boolean,
    onReport: () -> Unit,
    onSendToStudio: () -> Unit,
    onAudit: () -> Unit,
    onShareLink: suspend (String, String?) -> Result<String>,
) {
    WorkbenchCard(emphasized = true) {
        EyebrowKicker("Hypothesis card")
        Text(text = card.problem, style = LuminaraTextStyles.HeadlineSerif)
        if (card.whoAsksAi.persona.isNotBlank()) {
            EyebrowKicker("Who asks AI (model inference)")
            Text(text = card.whoAsksAi.persona, style = LuminaraTextStyles.Body)
            card.whoAsksAi.promptPatterns.forEach {
                Text(text = "\"$it\"", style = LuminaraTextStyles.Body.copy(color = LuminaraColors.Ink))
            }
        }
        if (card.contentBets.isNotEmpty()) {
            EyebrowKicker("Content bets")
            card.contentBets.forEachIndexed { index, bet ->
                Text(text = "${index + 1}. ${bet.hypothesis}", style = LuminaraTextStyles.Body)
            }
        }
        if (card.competitorCitation.snapshots.isNotEmpty()) {
            EyebrowKicker("Competitor pages")
            card.competitorCitation.snapshots.forEach { snapshot ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = snapshot.title ?: snapshot.hostname,
                        style = LuminaraTextStyles.Body,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                    )
                    MeasurementStatusBadge(snapshot.fetchStatus)
                }
            }
        }
        if (card.siteChecklist.isNotEmpty()) {
            EyebrowKicker("Site checklist")
            card.siteChecklist.forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(text = row.label, style = LuminaraTextStyles.Body, modifier = Modifier.weight(1f))
                    MeasurementStatusBadge(row.status)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GhostPillButton(
                text = if (savedToStudio) "In Studio" else "Send to Studio",
                onClick = onSendToStudio,
                enabled = !savedToStudio,
                icon = Icons.Outlined.Lightbulb,
                modifier = Modifier.weight(1f),
            )
            GhostPillButton(text = "I have a site", onClick = onAudit, modifier = Modifier.weight(1f))
        }
        ShareActions(
            subject = "Idea card",
            text = ideaAsSource(card),
            domain = null,
            testTagPrefix = "scout",
            onShareLink = onShareLink,
        )
        ReportAiOutput(reported = isReported, onReport = onReport)
    }
}
