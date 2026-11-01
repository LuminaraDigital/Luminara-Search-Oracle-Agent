package com.luminarasuite.app.feature.share

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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.AiEvidenceDisclosureBar
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.FoundryFieldColors
import com.luminarasuite.app.core.designsystem.LiveTrack
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.ReportAiOutput
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.ShareLink
import com.luminarasuite.app.core.model.SharedDocument
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.core.network.SharePasswordRequired
import com.luminarasuite.app.core.network.WorkspaceGateway
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SharedUiState(
    val link: ShareLink? = null,
    val isLoading: Boolean = false,
    val document: SharedDocument? = null,
    val needsPassword: Boolean = false,
    val password: String = "",
    val errorMessage: String? = null,
    val isReported: Boolean = false,
)

class SharedViewModel(
    private val workspace: WorkspaceGateway,
    private val repository: LuminaraRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SharedUiState())
    val uiState: StateFlow<SharedUiState> = _uiState.asStateFlow()

    fun open(link: ShareLink) {
        _uiState.value = SharedUiState(link = link)
        load()
    }

    fun updatePassword(value: String) = _uiState.update { it.copy(password = value) }

    fun load() {
        val state = _uiState.value
        val link = state.link ?: return
        _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            workspace.openShared(link, state.password.takeIf { it.isNotEmpty() })
                .onSuccess { doc ->
                    _uiState.update { it.copy(isLoading = false, document = doc, needsPassword = false) }
                }.onFailure { err ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            needsPassword = err is SharePasswordRequired,
                            errorMessage = err.message.takeIf { _ ->
                                state.password.isNotEmpty() ||
                                    err !is SharePasswordRequired
                            },
                        )
                    }
                }
        }
    }

    fun report() {
        val token = _uiState.value.link?.token ?: return
        viewModelScope.launch {
            repository.reportOracleTurn("share-$token")
            _uiState.update { it.copy(isReported = true) }
        }
    }
}

@Composable
fun SharedReportScreen(viewModel: SharedViewModel) {
    val state by viewModel.uiState.collectAsState()
    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = ScreenGutter, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        EyebrowKicker("Shared with you")
        if (state.isLoading) LiveTrack()
        state.errorMessage?.let {
            WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                Text(text = it, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }
        if (state.needsPassword) {
            WorkbenchCard {
                OutlinedTextField(
                    value = state.password,
                    onValueChange = viewModel::updatePassword,
                    label = { Text("Report password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    shape = RoundedCornerShape(16.dp),
                    colors = FoundryFieldColors(),
                    modifier = Modifier.fillMaxWidth().testTag("share_password_input"),
                )
                FoundryButton(text = "Open report", onClick = viewModel::load, testTag = "share_password_button")
            }
        }
        state.document?.let { doc ->
            Text(text = doc.title, style = LuminaraTextStyles.DisplaySerif)
            WorkbenchCard(emphasized = true) {
                Text(text = doc.body, style = LuminaraTextStyles.Body, modifier = Modifier.testTag("share_body"))
                ReportAiOutput(reported = state.isReported, onReport = viewModel::report)
            }
            if (doc.sources.isNotEmpty()) {
                WorkbenchCard {
                    EyebrowKicker("Sources")
                    doc.sources.forEach { source ->
                        Text(text = source.title.ifBlank { source.uri }, style = LuminaraTextStyles.Body)
                    }
                }
            }
            AiEvidenceDisclosureBar()
        }
    }
}
