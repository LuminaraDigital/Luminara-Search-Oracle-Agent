package com.luminarasuite.app.feature.enquiry

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.FoundryFieldColors
import com.luminarasuite.app.core.designsystem.GhostPillButton
import com.luminarasuite.app.core.designsystem.LiveTrack
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.ReportAiOutput
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.AppointmentRecord
import com.luminarasuite.app.core.model.EnquiryCreateRequest
import com.luminarasuite.app.core.model.EnquiryRecord
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.core.network.WorkspaceGateway
import com.luminarasuite.app.feature.today.segmentLabel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class EnquiryUiState(
    val enquiries: List<EnquiryRecord> = emptyList(),
    val appointments: List<AppointmentRecord> = emptyList(),
    val selectedId: String? = null,
    val name: String = "",
    val message: String = "",
    val contact: String = "",
    val address: String = "",
    val segment: String = "general_sme",
    val filter: String? = null,
    val reply: String = "",
    val isBusy: Boolean = false,
    val errorMessage: String? = null,
    val reportedIds: Set<String> = emptySet(),
)

class EnquiryDeskViewModel(
    private val workspace: WorkspaceGateway,
    private val repository: LuminaraRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(EnquiryUiState())
    val uiState: StateFlow<EnquiryUiState> = _uiState.asStateFlow()

    fun updateName(value: String) = _uiState.update { it.copy(name = value) }

    fun updateMessage(value: String) = _uiState.update { it.copy(message = value) }

    fun updateContact(value: String) = _uiState.update { it.copy(contact = value) }

    fun updateReply(value: String) = _uiState.update { it.copy(reply = value) }

    fun updateAddress(value: String) = _uiState.update { it.copy(address = value) }

    fun updateSegment(value: String) = _uiState.update { it.copy(segment = value) }

    fun updateFilter(value: String?) = _uiState.update { it.copy(filter = value) }

    fun select(id: String?) = _uiState.update { it.copy(selectedId = id, reply = "") }

    fun load() = act { Result.success(Unit) }

    private fun act(call: suspend () -> Result<Unit>) {
        _uiState.update { it.copy(isBusy = true, errorMessage = null) }
        viewModelScope.launch {
            val done = call()
            val desk = workspace.loadEnquiries()
            _uiState.update { state ->
                state.copy(
                    isBusy = false,
                    enquiries = desk.getOrNull()?.enquiries ?: state.enquiries,
                    appointments = desk.getOrNull()?.appointments ?: state.appointments,
                    errorMessage = (done.exceptionOrNull() ?: desk.exceptionOrNull())?.message,
                )
            }
        }
    }

    fun create() {
        val state = _uiState.value
        val contact = state.contact.trim()
        val request =
            EnquiryCreateRequest(
                fullName = state.name.trim(),
                initialMessage = state.message.trim(),
                email = contact.takeIf { it.contains('@') },
                phoneE164 = contact.takeIf { it.startsWith("+") },
                intentType = state.segment,
                propertyAddress = state.address.trim().ifBlank { null },
            )
        _uiState.update { it.copy(name = "", message = "", contact = "", address = "") }
        act { workspace.createEnquiry(request) }
    }

    fun sendReply() {
        val state = _uiState.value
        val id = state.selectedId ?: return
        _uiState.update { it.copy(reply = "") }
        act { workspace.replyToEnquiry(id, state.reply.trim()) }
    }

    fun togglePause(enquiry: EnquiryRecord) = act { workspace.setEnquiryPaused(enquiry.id, !enquiry.automationPaused) }

    fun decide(
        appointment: AppointmentRecord,
        approve: Boolean,
        slotId: String?,
    ) = act { workspace.decideAppointment(appointment.id, approve, slotId) }

    fun report(enquiryId: String) {
        viewModelScope.launch {
            repository.reportOracleTurn("enquiry-$enquiryId")
            _uiState.update { it.copy(reportedIds = it.reportedIds + enquiryId) }
        }
    }
}

@Composable
fun EnquiryDeskScreen(viewModel: EnquiryDeskViewModel) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.load() }
    val selected = state.enquiries.firstOrNull { it.id == state.selectedId }

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = ScreenGutter, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        EyebrowKicker("Your enquiries")
        Text(text = "Enquiry Desk", style = LuminaraTextStyles.DisplaySerif)
        if (state.isBusy) LiveTrack()
        state.errorMessage?.let {
            WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                Text(text = it, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
            }
        }
        if (selected != null) {
            EnquiryDetail(enquiry = selected, state = state, viewModel = viewModel)
        } else {
            NewEnquiryForm(state = state, viewModel = viewModel)
            if (state.enquiries.isEmpty() && !state.isBusy) {
                Text(text = "No enquiries yet.", style = LuminaraTextStyles.Body)
            } else {
                SegmentChips(selected = state.filter, allowAll = true, onSelect = viewModel::updateFilter)
            }
            state.enquiries.filter { state.filter == null || it.intentType == state.filter }.forEach { enquiry ->
                WorkbenchCard(onClick = { viewModel.select(enquiry.id) }) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(text = enquiry.contactName, style = LuminaraTextStyles.SectionTitle)
                        EyebrowKicker("${segmentLabel(enquiry.intentType)} · ${enquiry.status.replace('_', ' ')}")
                    }
                    enquiry.conversation.lastOrNull()?.let {
                        Text(text = it.text, style = LuminaraTextStyles.Body, maxLines = 2)
                    }
                }
            }
        }
    }
}

@Composable
private fun NewEnquiryForm(
    state: EnquiryUiState,
    viewModel: EnquiryDeskViewModel,
) {
    WorkbenchCard {
        EyebrowKicker("Log an enquiry")
        Text(text = "Who is it?", style = LuminaraTextStyles.Body)
        SegmentChips(selected = state.segment, allowAll = false, onSelect = {
            viewModel.updateSegment(
                it ?: "general_sme",
            )
        })
        DeskField("Their name", state.name, "enquiry_name_input", viewModel::updateName)
        DeskField("What they asked", state.message, "enquiry_message_input", viewModel::updateMessage)
        DeskField("Email or +61 phone (optional)", state.contact, "enquiry_contact_input", viewModel::updateContact)
        DeskField("Property address (optional)", state.address, "enquiry_address_input", viewModel::updateAddress)
        FoundryButton(
            text = "Add enquiry",
            onClick = viewModel::create,
            enabled = state.name.isNotBlank() && state.message.isNotBlank() && !state.isBusy,
            testTag = "enquiry_add_button",
        )
    }
}

@Composable
private fun EnquiryDetail(
    enquiry: EnquiryRecord,
    state: EnquiryUiState,
    viewModel: EnquiryDeskViewModel,
) {
    GhostPillButton(text = "All enquiries", onClick = { viewModel.select(null) })
    WorkbenchCard(emphasized = true) {
        Text(text = enquiry.contactName, style = LuminaraTextStyles.HeadlineSerif)
        listOfNotNull(enquiry.contactEmail, enquiry.contactPhone, enquiry.propertyAddress).forEach {
            Text(text = it, style = LuminaraTextStyles.Body)
        }
        val missing = enquiry.qualificationBrief.missingRequiredFields
        when {
            enquiry.qualificationBrief.qualified -> Text(
                text = "Qualified: ready for an appraisal.",
                style = LuminaraTextStyles.Body,
            )
            missing.isNotEmpty() ->
                Text(
                    text = "Still to ask: ${missing.joinToString {
                        it.replace('_', ' ')
                    }}",
                    style = LuminaraTextStyles.Body,
                )
        }
        GhostPillButton(
            text = if (enquiry.automationPaused) "Resume suggested replies" else "Take over from suggested replies",
            onClick = { viewModel.togglePause(enquiry) },
            testTag = "enquiry_takeover_button",
        )
    }
    state.appointments
        .filter { it.enquiryId == enquiry.id && it.approvalStatus == "pending_agent_signoff" }
        .forEach { appointment ->
            WorkbenchCard {
                EyebrowKicker("Needs your sign-off")
                appointment.proposedSlots.forEach { slot ->
                    GhostPillButton(
                        text = "Approve ${slot.label.ifBlank { slot.slotId }}",
                        onClick = { viewModel.decide(appointment, true, slot.slotId) },
                    )
                }
                GhostPillButton(text = "Decline", onClick = { viewModel.decide(appointment, false, null) })
            }
        }
    WorkbenchCard {
        EyebrowKicker("Conversation")
        enquiry.conversation.forEach { message ->
            val who =
                when (message.sender) {
                    "assistant" -> "AI suggestion"
                    "agent" -> "You"
                    else -> enquiry.contactName
                }
            Text(text = who, style = LuminaraTextStyles.EyebrowMono.copy(color = LuminaraColors.GoldLight))
            Text(text = message.text, style = LuminaraTextStyles.Body)
        }
        if (enquiry.conversation.any { it.sender == "assistant" }) {
            ReportAiOutput(reported = enquiry.id in state.reportedIds, onReport = { viewModel.report(enquiry.id) })
        }
        DeskField("Your reply", state.reply, "enquiry_reply_input", viewModel::updateReply)
        FoundryButton(
            text = "Record reply",
            onClick = viewModel::sendReply,
            enabled = state.reply.isNotBlank() && !state.isBusy,
            testTag = "enquiry_reply_button",
        )
    }
}

private val SEGMENTS = listOf("seller_appraisal", "buyer_enquiry", "landlord_management", "general_sme")

@Composable
private fun SegmentChips(
    selected: String?,
    allowAll: Boolean,
    onSelect: (String?) -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (allowAll) {
            FilterChip(selected = selected == null, onClick = { onSelect(null) }, label = { Text("All") })
        }
        SEGMENTS.forEach { segment ->
            FilterChip(
                selected = selected == segment,
                onClick = { onSelect(segment) },
                label = { Text(segmentLabel(segment)) },
                modifier = Modifier.testTag("segment_$segment"),
            )
        }
    }
}

@Composable
private fun DeskField(
    label: String,
    value: String,
    testTag: String,
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
