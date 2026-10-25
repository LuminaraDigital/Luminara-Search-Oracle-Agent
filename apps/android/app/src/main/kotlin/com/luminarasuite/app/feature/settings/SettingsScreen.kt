package com.luminarasuite.app.feature.settings

import android.content.Context
import androidx.browser.customtabs.CustomTabsIntent
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.BuildConfig
import com.luminarasuite.app.core.auth.VaultSnapshot
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.MeasurementStatusBadge
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.model.QuotaStatus
import com.luminarasuite.app.core.network.LuminaraRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SettingsUiState(
    val vault: VaultSnapshot = VaultSnapshot(),
    val emailInput: String = "",
    val passwordInput: String = "",
    val groqKeyInput: String = "",
    val nimKeyInput: String = "",
    val geminiKeyInput: String = "",
    val tavilyKeyInput: String = "",
    val deleteConfirmInput: String = "",
    val quota: QuotaStatus? = null,
    val isBusy: Boolean = false,
    val statusBanner: String? = null,
    val errorBanner: String? = null,
)

class SettingsViewModel(
    private val repository: LuminaraRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.vaultFlow.collect { snap ->
                _uiState.update {
                    it.copy(
                        vault = snap,
                        groqKeyInput = snap.byokKeys.groqKey,
                        nimKeyInput = snap.byokKeys.nimKey,
                        geminiKeyInput = snap.byokKeys.geminiKey,
                        tavilyKeyInput = snap.byokKeys.tavilyKey,
                    )
                }
            }
        }
    }

    fun updateEmail(value: String) = _uiState.update { it.copy(emailInput = value, errorBanner = null) }

    fun updatePassword(value: String) = _uiState.update { it.copy(passwordInput = value, errorBanner = null) }

    fun updateGroqKey(value: String) = _uiState.update { it.copy(groqKeyInput = value) }

    fun updateNimKey(value: String) = _uiState.update { it.copy(nimKeyInput = value) }

    fun updateGeminiKey(value: String) = _uiState.update { it.copy(geminiKeyInput = value) }

    fun updateTavilyKey(value: String) = _uiState.update { it.copy(tavilyKeyInput = value) }

    fun updateDeleteConfirm(value: String) = _uiState.update { it.copy(deleteConfirmInput = value) }

    fun signIn() {
        val email = _uiState.value.emailInput
        val pass = _uiState.value.passwordInput
        _uiState.update { it.copy(isBusy = true, errorBanner = null, statusBanner = null) }
        viewModelScope.launch {
            repository.signIn(email, pass)
                .onSuccess { quota ->
                    _uiState.update {
                        it.copy(
                            isBusy = false,
                            passwordInput = "",
                            quota = quota,
                            statusBanner = "Signed in to Luminara workspace.",
                        )
                    }
                }
                .onFailure { err ->
                    _uiState.update {
                        it.copy(isBusy = false, errorBanner = err.message ?: "Sign-in failed.")
                    }
                }
        }
    }

    fun signUp() {
        val email = _uiState.value.emailInput
        val pass = _uiState.value.passwordInput
        _uiState.update { it.copy(isBusy = true, errorBanner = null, statusBanner = null) }
        viewModelScope.launch {
            repository.signUp(email, pass)
                .onSuccess { quota ->
                    _uiState.update {
                        it.copy(
                            isBusy = false,
                            passwordInput = "",
                            quota = quota,
                            statusBanner = "Account created and signed in.",
                        )
                    }
                }
                .onFailure { err ->
                    _uiState.update {
                        it.copy(isBusy = false, errorBanner = err.message ?: "Account creation failed.")
                    }
                }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            repository.signOut()
            _uiState.update {
                it.copy(quota = null, statusBanner = "Signed out.", errorBanner = null)
            }
        }
    }

    fun saveByokKeys() {
        val state = _uiState.value
        viewModelScope.launch {
            repository.saveByokKeys(
                ByokKeyBag(
                    groqKey = state.groqKeyInput,
                    nimKey = state.nimKeyInput,
                    geminiKey = state.geminiKeyInput,
                    tavilyKey = state.tavilyKeyInput,
                ),
            )
            _uiState.update {
                it.copy(statusBanner = "BYOK keys encrypted and saved to Android Keystore.", errorBanner = null)
            }
        }
    }

    fun exportData() {
        _uiState.update { it.copy(isBusy = true, errorBanner = null, statusBanner = null) }
        viewModelScope.launch {
            repository.exportAccountData()
                .onSuccess { msg ->
                    _uiState.update { it.copy(isBusy = false, statusBanner = msg) }
                }
                .onFailure { err ->
                    _uiState.update { it.copy(isBusy = false, errorBanner = err.message) }
                }
        }
    }

    fun deleteAccount() {
        val confirm = _uiState.value.deleteConfirmInput
        _uiState.update { it.copy(isBusy = true, errorBanner = null, statusBanner = null) }
        viewModelScope.launch {
            repository.deleteAccountPermanently(confirm)
                .onSuccess {
                    _uiState.update {
                        it.copy(
                            isBusy = false,
                            deleteConfirmInput = "",
                            quota = null,
                            statusBanner = "Account and all cloud/local data permanently erased.",
                        )
                    }
                }
                .onFailure { err ->
                    _uiState.update {
                        it.copy(isBusy = false, errorBanner = err.message ?: "Account deletion failed.")
                    }
                }
        }
    }
}

@Composable
fun SettingsScreen(viewModel: SettingsViewModel) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val scrollState = rememberScrollState()

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        EyebrowKicker("ACCOUNT, BYOK VAULT & PRIVACY")
        Text(text = "Settings", style = LuminaraTextStyles.DisplaySerif)

        state.statusBanner?.let { msg ->
            WorkbenchCard {
                Text(text = msg, style = LuminaraTextStyles.Body, color = LuminaraColors.PassGreen)
            }
        }

        state.errorBanner?.let { err ->
            WorkbenchCard {
                Text(text = err, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }

        AccountSection(state = state, viewModel = viewModel)
        ByokVaultSection(state = state, viewModel = viewModel)
        PrivacyAndLegalSection(state = state, viewModel = viewModel, context = context)

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun AccountSection(
    state: SettingsUiState,
    viewModel: SettingsViewModel,
) {
    WorkbenchCard(emphasized = true) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            EyebrowKicker("WORKSPACE ACCOUNT")
            MeasurementStatusBadge(if (state.vault.isSignedIn) "MEASURED" else "GUEST")
        }

        if (state.vault.isSignedIn) {
            Text(text = state.vault.email, style = LuminaraTextStyles.SectionTitle)
            val planLabel = state.quota?.plan?.uppercase() ?: "FREE COMPANION"
            val remainingLabel =
                state.quota?.let { "${it.remaining}/${it.limit} daily hosted checks remaining" }
                    ?: "3 daily hosted checks included"
            Text(text = "Tier: $planLabel · $remainingLabel", style = LuminaraTextStyles.Body)
            OutlinedButton(
                onClick = viewModel::signOut,
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.fillMaxWidth().testTag("sign_out_button"),
            ) {
                Text("Sign Out")
            }
        } else {
            Text(
                text = "Sign in with your Luminara account for cloud history sync and 3 hosted AI checks per day.",
                style = LuminaraTextStyles.Body,
            )
            OutlinedTextField(
                value = state.emailInput,
                onValueChange = viewModel::updateEmail,
                label = { Text("Email address") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("settings_email_input"),
            )
            OutlinedTextField(
                value = state.passwordInput,
                onValueChange = viewModel::updatePassword,
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().testTag("settings_password_input"),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = viewModel::signIn,
                    enabled = !state.isBusy,
                    shape = RoundedCornerShape(999.dp),
                    colors =
                    ButtonDefaults.buttonColors(
                        containerColor = LuminaraColors.GoldAccent,
                        contentColor = LuminaraColors.AccentInk,
                    ),
                    modifier = Modifier.weight(1f).height(48.dp).testTag("sign_in_button"),
                ) {
                    Text("Sign In")
                }
                OutlinedButton(
                    onClick = viewModel::signUp,
                    enabled = !state.isBusy,
                    shape = RoundedCornerShape(999.dp),
                    modifier = Modifier.weight(1f).height(48.dp).testTag("sign_up_button"),
                ) {
                    Text("Create Account")
                }
            }
        }
    }
}

@Composable
private fun ByokVaultSection(
    state: SettingsUiState,
    viewModel: SettingsViewModel,
) {
    WorkbenchCard {
        EyebrowKicker("BYOK API KEY VAULT (ANDROID KEYSTORE AES-GCM)")
        Text(
            text = "Bring your own API keys for unlimited un-metered queries. Keys are encrypted on-device.",
            style = LuminaraTextStyles.Body,
        )
        OutlinedTextField(
            value = state.groqKeyInput,
            onValueChange = viewModel::updateGroqKey,
            label = { Text("Groq API Key (gsk_...)") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().testTag("byok_groq_input"),
        )
        OutlinedTextField(
            value = state.tavilyKeyInput,
            onValueChange = viewModel::updateTavilyKey,
            label = { Text("Tavily Search API Key (tvly-...)") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().testTag("byok_tavily_input"),
        )
        OutlinedTextField(
            value = state.geminiKeyInput,
            onValueChange = viewModel::updateGeminiKey,
            label = { Text("Google Gemini API Key") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = state.nimKeyInput,
            onValueChange = viewModel::updateNimKey,
            label = { Text("NVIDIA NIM API Key (nvapi-...)") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = viewModel::saveByokKeys,
            shape = RoundedCornerShape(999.dp),
            colors =
            ButtonDefaults.buttonColors(
                containerColor = LuminaraColors.GoldAccent,
                contentColor = LuminaraColors.AccentInk,
            ),
            modifier = Modifier.fillMaxWidth().height(48.dp).testTag("save_byok_button"),
        ) {
            Text("Save Encrypted Keys")
        }
    }
}

@Composable
private fun PrivacyAndLegalSection(
    state: SettingsUiState,
    viewModel: SettingsViewModel,
    context: Context,
) {
    WorkbenchCard {
        EyebrowKicker("PRIVACY, DATA EXPORT & ACCOUNT DELETION")
        Text(
            text = "Operator: Luminara Digital Pty Ltd (ABN 90 693 125 281). All traffic uses HTTPS/TLS.",
            style = LuminaraTextStyles.Body,
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                onClick = { openCustomTab(context, "${BuildConfig.WEB_BASE_URL}/privacy") },
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.weight(1f),
            ) {
                Text("Privacy Policy")
            }
            OutlinedButton(
                onClick = { openCustomTab(context, "${BuildConfig.WEB_BASE_URL}/terms") },
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.weight(1f),
            ) {
                Text("Terms")
            }
            OutlinedButton(
                onClick = { openCustomTab(context, "${BuildConfig.WEB_BASE_URL}/contact") },
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.weight(1f),
            ) {
                Text("Support")
            }
        }

        if (state.vault.isSignedIn) {
            OutlinedButton(
                onClick = viewModel::exportData,
                enabled = !state.isBusy,
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Export Account Data (JSON)")
            }

            OutlinedTextField(
                value = state.deleteConfirmInput,
                onValueChange = viewModel::updateDeleteConfirm,
                label = { Text("Type DELETE to permanently erase account") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("delete_confirm_input"),
            )
            OutlinedButton(
                onClick = viewModel::deleteAccount,
                enabled = !state.isBusy,
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.fillMaxWidth().testTag("delete_account_button"),
            ) {
                Text("Permanently Delete Account & Data", color = LuminaraColors.ErrorRed)
            }
        }
    }
}

private fun openCustomTab(
    context: Context,
    url: String,
) {
    runCatching {
        CustomTabsIntent.Builder().build().launchUrl(context, url.toUri())
    }
}
