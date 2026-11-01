package com.luminarasuite.app.feature.settings

import android.Manifest
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.BuildConfig
import com.luminarasuite.app.core.auth.VaultSnapshot
import com.luminarasuite.app.core.auth.requestGoogleIdToken
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.FoundryFieldColors
import com.luminarasuite.app.core.designsystem.LiveTrack
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.model.QuotaStatus
import com.luminarasuite.app.core.model.hostedPlanCopy
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.core.reminders.NextFixReminder
import kotlinx.coroutines.CancellationException
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
            var initialKeysLoaded = false
            var lastStoredKeys = ByokKeyBag()
            repository.vaultFlow.collect { snap ->
                val keysChanged = !initialKeysLoaded || snap.byokKeys != lastStoredKeys
                initialKeysLoaded = true
                lastStoredKeys = snap.byokKeys
                _uiState.update { current ->
                    current.copy(
                        vault = snap,
                        groqKeyInput = if (keysChanged) snap.byokKeys.groqKey else current.groqKeyInput,
                        nimKeyInput = if (keysChanged) snap.byokKeys.nimKey else current.nimKeyInput,
                        geminiKeyInput = if (keysChanged) snap.byokKeys.geminiKey else current.geminiKeyInput,
                        tavilyKeyInput = if (keysChanged) snap.byokKeys.tavilyKey else current.tavilyKeyInput,
                    )
                }
                if (snap.isSignedIn && _uiState.value.quota == null) {
                    repository.refreshQuota().onSuccess { quota ->
                        _uiState.update { it.copy(quota = quota) }
                    }
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

    fun signInWithGoogle(activityContext: Context) {
        _uiState.update { it.copy(isBusy = true, errorBanner = null, statusBanner = null) }
        viewModelScope.launch {
            val result =
                runCatching { requestGoogleIdToken(activityContext, BuildConfig.GOOGLE_WEB_CLIENT_ID) }
                    .onFailure { if (it is CancellationException) throw it }
            val token = result.getOrNull()
            when {
                result.isFailure ->
                    _uiState.update {
                        it.copy(isBusy = false, errorBanner = "Google sign-in is unavailable on this device.")
                    }
                token == null -> _uiState.update { it.copy(isBusy = false) }
                else ->
                    repository.signInWithGoogle(token)
                        .onSuccess { quota ->
                            _uiState.update {
                                it.copy(isBusy = false, quota = quota, statusBanner = "Signed in with Google.")
                            }
                        }.onFailure { err ->
                            _uiState.update {
                                it.copy(isBusy = false, errorBanner = err.message ?: "Google sign-in failed.")
                            }
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
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onOpenProfile: () -> Unit = {},
    onOpenEnquiries: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val scrollState = rememberScrollState()

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = ScreenGutter, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        EyebrowKicker("Account and privacy")
        Text(text = "Settings", style = LuminaraTextStyles.DisplaySerif)
        if (state.isBusy) {
            LiveTrack()
        }

        state.statusBanner?.let { msg ->
            WorkbenchCard(railColor = LuminaraColors.PassGreen) {
                Text(text = msg, style = LuminaraTextStyles.Body, color = LuminaraColors.PassGreen)
            }
        }

        state.errorBanner?.let { err ->
            WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                Text(text = err, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }

        AccountSection(state = state, viewModel = viewModel)
        if (state.vault.isSignedIn) {
            BusinessSection(onOpenProfile = onOpenProfile, onOpenEnquiries = onOpenEnquiries)
        }
        ReminderSection()
        ByokVaultSection(state = state, viewModel = viewModel)
        PrivacyAndLegalSection(state = state, viewModel = viewModel, context = context)

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun BusinessSection(
    onOpenProfile: () -> Unit,
    onOpenEnquiries: () -> Unit,
) {
    WorkbenchCard {
        EyebrowKicker("Your business")
        OutlinedButton(
            onClick = onOpenProfile,
            shape = RoundedCornerShape(999.dp),
            modifier = Modifier.fillMaxWidth().testTag("open_profile_button"),
        ) {
            Text("Business Profile")
        }
        OutlinedButton(
            onClick = onOpenEnquiries,
            shape = RoundedCornerShape(999.dp),
            modifier = Modifier.fillMaxWidth().testTag("open_enquiries_button"),
        ) {
            Text("Enquiry Desk")
        }
    }
}

@Composable
private fun ReminderSection() {
    val context = LocalContext.current
    var enabled by remember { mutableStateOf(NextFixReminder.isEnabled(context)) }
    val apply = { on: Boolean ->
        NextFixReminder.setEnabled(context, on)
        enabled = on
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { apply(it) }
    WorkbenchCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                EyebrowKicker("Weekly next fix")
                Text(
                    text = "A weekly nudge with your top open fix. It stays on this device.",
                    style = LuminaraTextStyles.Body,
                )
            }
            Switch(
                checked = enabled,
                onCheckedChange = { on ->
                    if (on && NextFixReminder.needsPermission(context)) {
                        permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        apply(on)
                    }
                },
                modifier = Modifier.testTag("reminder_switch"),
            )
        }
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
            EyebrowKicker("Workspace")
            Text(
                text = if (state.vault.isSignedIn) "Signed in" else "Guest",
                style =
                LuminaraTextStyles.EyebrowMono.copy(
                    color = if (state.vault.isSignedIn) LuminaraColors.PassGreen else LuminaraColors.Ink2,
                ),
            )
        }

        if (state.vault.isSignedIn) {
            val plan = hostedPlanCopy(signedIn = true, quota = state.quota)
            Text(text = state.vault.email, style = LuminaraTextStyles.SectionTitle)
            Text(
                text = plan.title,
                style = LuminaraTextStyles.Body,
                modifier = Modifier.testTag("plan_title"),
            )
            Text(
                text = plan.detail,
                style = LuminaraTextStyles.Body,
                modifier = Modifier.testTag("plan_detail"),
            )
            plan.manage?.let { note ->
                Text(
                    text = note,
                    style = LuminaraTextStyles.Body,
                    modifier = Modifier.testTag("plan_manage_note"),
                )
            }
            OutlinedButton(
                onClick = viewModel::signOut,
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.fillMaxWidth().testTag("sign_out_button"),
            ) {
                Text("Sign out")
            }
        } else {
            val guestPlan = hostedPlanCopy(signedIn = false, quota = null)
            Text(
                text = "Guest mode probes live files. ${guestPlan.detail}",
                style = LuminaraTextStyles.Body,
            )
            guestPlan.manage?.let { note ->
                Text(
                    text = note,
                    style = LuminaraTextStyles.Body,
                    modifier = Modifier.testTag("plan_manage_note"),
                )
            }
            if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()) {
                val context = LocalContext.current
                FoundryButton(
                    text = "Continue with Google",
                    onClick = { viewModel.signInWithGoogle(context) },
                    enabled = !state.isBusy,
                    testTag = "google_sign_in_button",
                )
            }
            OutlinedTextField(
                value = state.emailInput,
                onValueChange = viewModel::updateEmail,
                label = { Text("Email address") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                shape = RoundedCornerShape(16.dp),
                colors = FoundryFieldColors(),
                modifier = Modifier.fillMaxWidth().testTag("settings_email_input"),
            )
            OutlinedTextField(
                value = state.passwordInput,
                onValueChange = viewModel::updatePassword,
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                shape = RoundedCornerShape(16.dp),
                colors = FoundryFieldColors(),
                modifier = Modifier.fillMaxWidth().testTag("settings_password_input"),
            )
            FoundryButton(
                text = "Sign in",
                onClick = viewModel::signIn,
                enabled = !state.isBusy,
                testTag = "sign_in_button",
            )
            OutlinedButton(
                onClick = viewModel::signUp,
                enabled = !state.isBusy,
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp).testTag("sign_up_button"),
            ) {
                Text("Create account")
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
        EyebrowKicker("Your keys")
        Text(
            text =
            "Groq, Tavily, Gemini, or NVIDIA NIM. " +
                "Encrypted on this device with the Android Keystore.",
            style = LuminaraTextStyles.Body,
        )
        SecretField(
            value = state.groqKeyInput,
            onValueChange = viewModel::updateGroqKey,
            label = "Groq API key (gsk_...)",
            testTag = "byok_groq_input",
        )
        SecretField(
            value = state.tavilyKeyInput,
            onValueChange = viewModel::updateTavilyKey,
            label = "Tavily search key (tvly-...)",
            testTag = "byok_tavily_input",
        )
        SecretField(
            value = state.geminiKeyInput,
            onValueChange = viewModel::updateGeminiKey,
            label = "Google Gemini API key",
        )
        SecretField(
            value = state.nimKeyInput,
            onValueChange = viewModel::updateNimKey,
            label = "NVIDIA NIM API key (nvapi-...)",
        )
        FoundryButton(
            text = "Save encrypted keys",
            onClick = viewModel::saveByokKeys,
            testTag = "save_byok_button",
        )
    }
}

@Composable
private fun PrivacyAndLegalSection(
    state: SettingsUiState,
    viewModel: SettingsViewModel,
    context: Context,
) {
    WorkbenchCard {
        EyebrowKicker("Privacy")
        Text(
            text = "Operator: Luminara Digital Pty Ltd (ABN 90 693 125 281). All traffic uses HTTPS/TLS.",
            style = LuminaraTextStyles.Body,
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                onClick = { openCustomTab(context, "${BuildConfig.WEB_BASE_URL}/privacy?client=android") },
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.weight(1f),
            ) {
                Text("Privacy Policy")
            }
            OutlinedButton(
                onClick = { openCustomTab(context, "${BuildConfig.WEB_BASE_URL}/terms?client=android") },
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.weight(1f),
            ) {
                Text("Terms")
            }
            OutlinedButton(
                onClick = { openCustomTab(context, "${BuildConfig.WEB_BASE_URL}/contact?client=android") },
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
                Text("Export account data")
            }

            OutlinedTextField(
                value = state.deleteConfirmInput,
                onValueChange = viewModel::updateDeleteConfirm,
                label = { Text("Type DELETE to erase this account") },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                colors = FoundryFieldColors(),
                modifier = Modifier.fillMaxWidth().testTag("delete_confirm_input"),
            )
            OutlinedButton(
                onClick = viewModel::deleteAccount,
                enabled = !state.isBusy,
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.fillMaxWidth().testTag("delete_account_button"),
            ) {
                Text("Delete account and data", color = LuminaraColors.ErrorRed)
            }
        }
    }
}

@Composable
private fun SecretField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    testTag: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        shape = RoundedCornerShape(16.dp),
        colors = FoundryFieldColors(),
        modifier =
        Modifier
            .fillMaxWidth()
            .then(if (testTag != null) Modifier.testTag(testTag) else Modifier),
    )
}

private fun openCustomTab(
    context: Context,
    url: String,
) {
    runCatching {
        CustomTabsIntent.Builder().build().launchUrl(context, url.toUri())
    }
}
