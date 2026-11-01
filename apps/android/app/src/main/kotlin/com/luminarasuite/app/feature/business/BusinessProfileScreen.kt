package com.luminarasuite.app.feature.business

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.FoundryFieldColors
import com.luminarasuite.app.core.designsystem.LiveTrack
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.BusinessDna
import com.luminarasuite.app.core.network.WorkspaceGateway
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProfileUiState(
    val profile: BusinessDna = BusinessDna(),
    val competitors: String = "",
    val gaps: String = "",
    val isBusy: Boolean = false,
    val message: String? = null,
    val errorMessage: String? = null,
)

class BusinessProfileViewModel(
    private val workspace: WorkspaceGateway,
) : ViewModel() {
    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()
    private var running: Job? = null

    fun reset() {
        running?.cancel()
        _uiState.value = ProfileUiState()
    }

    fun load() {
        _uiState.update { it.copy(isBusy = true, errorMessage = null, message = null) }
        running = viewModelScope.launch {
            workspace.loadProfile()
                .onSuccess { profile ->
                    _uiState.update {
                        it.copy(
                            isBusy = false,
                            profile = profile,
                            competitors = profile.competitors.joinToString(", "),
                            gaps = profile.perceivedGaps.joinToString(", "),
                        )
                    }
                }.onFailure { err -> _uiState.update { it.copy(isBusy = false, errorMessage = err.message) } }
        }
    }

    fun edit(change: (BusinessDna) -> BusinessDna) = _uiState.update {
        it.copy(profile = change(it.profile), message = null)
    }

    fun updateCompetitors(value: String) = _uiState.update { it.copy(competitors = value, message = null) }

    fun updateGaps(value: String) = _uiState.update { it.copy(gaps = value, message = null) }

    private fun listOf(text: String): List<String> = text.split(',').map { it.trim() }.filter { it.isNotEmpty() }

    fun save() {
        val state = _uiState.value
        val profile = state.profile.copy(competitors = listOf(state.competitors), perceivedGaps = listOf(state.gaps))
        _uiState.update { it.copy(isBusy = true, errorMessage = null, message = null) }
        running = viewModelScope.launch {
            workspace.saveProfile(profile)
                .onSuccess { _uiState.update { it.copy(isBusy = false, message = "Saved to your account.") } }
                .onFailure { err -> _uiState.update { it.copy(isBusy = false, errorMessage = err.message) } }
        }
    }
}

@Composable
fun BusinessProfileScreen(viewModel: BusinessProfileViewModel) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.load() }
    val profile = state.profile

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = ScreenGutter, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        EyebrowKicker("Your business")
        Text(text = "Business Profile", style = LuminaraTextStyles.DisplaySerif)
        Text(
            text = "The same profile your web and Telegram workspaces use.",
            style = LuminaraTextStyles.Body,
        )
        if (state.isBusy) LiveTrack()
        state.errorMessage?.let {
            WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                Text(text = it, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }
        WorkbenchCard {
            ProfileField("Business name", profile.name, "profile_name_input") { v ->
                viewModel.edit { it.copy(name = v) }
            }
            ProfileField("Mission", profile.mission) { v -> viewModel.edit { it.copy(mission = v) } }
            ProfileField("What makes you different", profile.usp) { v -> viewModel.edit { it.copy(usp = v) } }
            ProfileField("Who you serve", profile.targetAudience) { v ->
                viewModel.edit { it.copy(targetAudience = v) }
            }
            ProfileField("Industry", profile.industry.orEmpty()) { v -> viewModel.edit { it.copy(industry = v) } }
            ProfileField("Suburb", profile.suburb.orEmpty()) { v -> viewModel.edit { it.copy(suburb = v) } }
            ProfileField("State", profile.state.orEmpty()) { v -> viewModel.edit { it.copy(state = v) } }
            ProfileField("Competitors, comma separated", state.competitors, onChange = viewModel::updateCompetitors)
            ProfileField("Known gaps, comma separated", state.gaps, onChange = viewModel::updateGaps)
            FoundryButton(
                text = "Save profile",
                onClick = viewModel::save,
                enabled = !state.isBusy,
                testTag = "profile_save_button",
            )
            state.message?.let {
                Text(text = it, style = LuminaraTextStyles.Body, color = LuminaraColors.PassGreen)
            }
        }
    }
}

@Composable
private fun ProfileField(
    label: String,
    value: String,
    testTag: String = "",
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        shape = RoundedCornerShape(16.dp),
        colors = FoundryFieldColors(),
        modifier = Modifier.fillMaxWidth().testTag(testTag),
    )
}
