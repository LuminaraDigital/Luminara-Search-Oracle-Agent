package com.luminarasuite.app.feature.today

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.CalendarContract
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.GhostPillButton
import com.luminarasuite.app.core.designsystem.LiveTrack
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.AgentTodayResponse
import com.luminarasuite.app.core.model.ScorecardSegment
import com.luminarasuite.app.core.model.TodayItem
import com.luminarasuite.app.core.network.WorkspaceGateway
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

data class TodayUiState(
    val today: AgentTodayResponse? = null,
    val isBusy: Boolean = false,
    val errorMessage: String? = null,
)

class TodayViewModel(
    private val workspace: WorkspaceGateway,
) : ViewModel() {
    private val _uiState = MutableStateFlow(TodayUiState())
    val uiState: StateFlow<TodayUiState> = _uiState.asStateFlow()

    fun load() = act { Result.success(Unit) }

    fun approve(
        item: TodayItem,
        slotId: String,
    ) = item.appointmentId?.let { id -> act { workspace.decideAppointment(id, true, slotId) } }

    fun decline(item: TodayItem) = item.appointmentId?.let { id ->
        act { workspace.decideAppointment(id, false, null) }
    }

    private fun act(call: suspend () -> Result<Unit>) {
        _uiState.update { it.copy(isBusy = true, errorMessage = null) }
        viewModelScope.launch {
            val done = call()
            val today = workspace.loadToday()
            _uiState.update { state ->
                state.copy(
                    isBusy = false,
                    today = today.getOrNull() ?: state.today,
                    errorMessage = (done.exceptionOrNull() ?: today.exceptionOrNull())?.message,
                )
            }
        }
    }
}

/** The agent's minute between inspections: approve, call back, see the week. The app never sends a message itself. */
@Composable
fun TodayScreen(
    viewModel: TodayViewModel,
    signedIn: Boolean,
    onSignIn: () -> Unit,
    onOpenEnquiries: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(signedIn) { if (signedIn) viewModel.load() }
    val context = LocalContext.current

    Column(
        modifier =
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = ScreenGutter, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        EyebrowKicker("For agents")
        Text(text = "Today", style = LuminaraTextStyles.DisplaySerif)
        if (!signedIn) {
            WorkbenchCard {
                Text(
                    text = "Sign in to see who needs your sign-off and who to call back.",
                    style = LuminaraTextStyles.Body,
                )
                FoundryButton(text = "Sign in", onClick = onSignIn, testTag = "today_sign_in")
            }
            return@Column
        }
        if (state.isBusy) LiveTrack()
        state.errorMessage?.let {
            WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                Text(text = it, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
                GhostPillButton(text = "Try again", onClick = viewModel::load)
            }
        }
        val today = state.today ?: return@Column

        EyebrowKicker("Needs your sign-off")
        if (today.needsSignOff.isEmpty()) Text(text = "Nothing waiting for you.", style = LuminaraTextStyles.Body)
        today.needsSignOff.forEach { item ->
            WorkbenchCard(emphasized = true) {
                PersonHeader(item)
                Text(text = "Pick a time to approve the appraisal:", style = LuminaraTextStyles.Body)
                item.slots.forEach { slot ->
                    FoundryButton(
                        text = "Approve ${slot.label.ifBlank { slot.slotId }}",
                        onClick = { viewModel.approve(item, slot.slotId) },
                        enabled = !state.isBusy,
                        testTag = "today_approve_${item.appointmentId}_${slot.slotId}",
                    )
                }
                GhostPillButton(text = "Decline", onClick = { viewModel.decline(item) }, enabled = !state.isBusy)
                ContactButtons(context, item)
            }
        }

        EyebrowKicker("Call back")
        if (today.callBack.isEmpty()) Text(text = "No one is waiting on a call.", style = LuminaraTextStyles.Body)
        today.callBack.forEach { item ->
            WorkbenchCard(railColor = LuminaraColors.GoldAccent) {
                PersonHeader(item)
                item.reason?.let { Text(text = it, style = LuminaraTextStyles.Body) }
                ContactButtons(context, item)
            }
        }

        if (today.upcoming.isNotEmpty()) {
            EyebrowKicker("Coming up")
            today.upcoming.forEach { item ->
                WorkbenchCard {
                    PersonHeader(item)
                    Text(text = formatTime(item.startAt), style = LuminaraTextStyles.Body)
                    GhostPillButton(text = "Add to calendar", onClick = { addToCalendar(context, item) })
                    ContactButtons(context, item)
                }
            }
        }

        EyebrowKicker("Last 7 days")
        Scorecard(today.scorecard.segments)

        GhostPillButton(text = "Open all enquiries", onClick = onOpenEnquiries, testTag = "today_open_enquiries")
    }
}

@Composable
private fun PersonHeader(item: TodayItem) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(text = item.name, style = LuminaraTextStyles.SectionTitle)
        EyebrowKicker(segmentLabel(item.segment))
    }
    item.address?.let { Text(text = it, style = LuminaraTextStyles.Body) }
}

@Composable
private fun ContactButtons(
    context: Context,
    item: TodayItem,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item.phone?.let { phone ->
            GhostPillButton(text = "Call", onClick = {
                open(context, Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")))
            })
            GhostPillButton(text = "SMS", onClick = {
                open(context, Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$phone")))
            })
        }
        item.email?.let { email ->
            GhostPillButton(text = "Email", onClick = {
                open(context, Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$email")))
            })
        }
    }
}

@Composable
private fun Scorecard(segments: List<ScorecardSegment>) {
    WorkbenchCard {
        if (segments.all { it.enquiries + it.qualified + it.appraisalsBooked == 0 }) {
            Text(text = "Nothing recorded in the last 7 days yet.", style = LuminaraTextStyles.Body)
            return@WorkbenchCard
        }
        segments.forEach { s ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(text = s.label, style = LuminaraTextStyles.SectionTitle)
                Text(
                    text = "${s.enquiries} new · ${s.qualified} qualified · ${s.appraisalsBooked} booked",
                    style = LuminaraTextStyles.Body,
                )
            }
        }
    }
}

fun segmentLabel(segment: String): String =
    when (segment) {
        "seller_appraisal" -> "Seller"
        "buyer_enquiry" -> "Buyer"
        "landlord_management" -> "Landlord"
        else -> "Other"
    }

private fun formatTime(epochMs: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(epochMs))

private fun addToCalendar(
    context: Context,
    item: TodayItem,
) {
    val intent =
        Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, "Appraisal: ${item.name}")
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, item.startAt)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, item.endAt)
    item.address?.let { intent.putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
    open(context, intent)
}

private fun open(
    context: Context,
    intent: Intent,
) {
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // No phone, SMS, mail or calendar app on this device. Nothing else to do.
    }
}
