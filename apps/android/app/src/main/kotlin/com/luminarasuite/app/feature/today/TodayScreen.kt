package com.luminarasuite.app.feature.today

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.CalendarContract
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import com.luminarasuite.app.core.model.SignOffItem
import com.luminarasuite.app.core.model.TodayPerson
import com.luminarasuite.app.core.model.UpcomingItem
import com.luminarasuite.app.core.network.WorkspaceGateway
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Shown instead of server or network text, which agents cannot act on. */
const val TRY_AGAIN = "That did not go through. Nothing was changed. Try again."

data class TodayUiState(
    val today: AgentTodayResponse? = null,
    val isBusy: Boolean = false,
    val failed: Boolean = false,
    val notice: String? = null,
)

class TodayViewModel(
    private val workspace: WorkspaceGateway,
) : ViewModel() {
    private val _uiState = MutableStateFlow(TodayUiState())
    val uiState: StateFlow<TodayUiState> = _uiState.asStateFlow()

    fun load() = act(null) { Result.success(Unit) }

    fun approve(
        item: SignOffItem,
        slotId: String,
    ) = act("Booking approved.") { workspace.decideAppointment(item.appointmentId, true, slotId) }

    fun decline(item: SignOffItem) = act("Booking declined.") {
        workspace.decideAppointment(item.appointmentId, false, null)
    }

    private fun act(
        success: String?,
        call: suspend () -> Result<Unit>,
    ) {
        _uiState.update { it.copy(isBusy = true, failed = false, notice = null) }
        viewModelScope.launch {
            val done = call()
            val today = workspace.loadToday()
            _uiState.update { state ->
                state.copy(
                    isBusy = false,
                    today = today.getOrNull() ?: state.today,
                    failed = done.isFailure || today.isFailure,
                    notice = success.takeIf { done.isSuccess },
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
                Text(text = "Sign in to see your day.", style = LuminaraTextStyles.Body)
                FoundryButton(text = "Sign in", onClick = onSignIn, testTag = "today_sign_in")
            }
            return@Column
        }
        if (state.isBusy) LiveTrack()
        state.notice?.let { Text(text = it, style = LuminaraTextStyles.Body, color = LuminaraColors.PassGreen) }
        if (state.failed) {
            WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                Text(text = TRY_AGAIN, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
                GhostPillButton(text = "Try again", onClick = viewModel::load)
            }
        }
        val today = state.today
        if (today == null) {
            if (!state.failed) Text(text = "Loading your day...", style = LuminaraTextStyles.Body)
            return@Column
        }

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
                Text(text = item.reason, style = LuminaraTextStyles.Body)
                ContactButtons(context, item)
            }
        }

        if (today.upcoming.isNotEmpty()) {
            EyebrowKicker("Coming up")
            today.upcoming.forEach { item ->
                WorkbenchCard {
                    PersonHeader(item)
                    Text(text = formatMelbourne(item.startAt), style = LuminaraTextStyles.Body)
                    GhostPillButton(text = "Add to calendar", onClick = { addToCalendar(context, item) })
                    ContactButtons(context, item)
                }
            }
        }

        EyebrowKicker("Last 7 days")
        Text(
            text = "${formatDay(today.scorecard.since)} to ${formatDay(today.scorecard.until)}",
            style = LuminaraTextStyles.Body.copy(color = LuminaraColors.Ink3),
        )
        Scorecard(today.scorecard.segments)

        GhostPillButton(text = "Open all enquiries", onClick = onOpenEnquiries, testTag = "today_open_enquiries")
    }
}

@Composable
private fun PersonHeader(item: TodayPerson) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(text = item.name, style = LuminaraTextStyles.SectionTitle)
        EyebrowKicker(segmentLabel(item.segment))
    }
    item.address?.let { Text(text = it, style = LuminaraTextStyles.Body) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ContactButtons(
    context: Context,
    item: TodayPerson,
) {
    val phone = dialablePhone(item.phone)
    val email = safeEmail(item.email)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        phone?.let {
            GhostPillButton(text = "Call", onClick = {
                open(context, Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", it, null)))
            })
            GhostPillButton(text = "Text", onClick = {
                open(context, Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", it, null)))
            })
        }
        email?.let {
            GhostPillButton(text = "Email", onClick = {
                open(context, Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", it, null)))
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
            Text(text = s.label, style = LuminaraTextStyles.SectionTitle)
            Text(text = scorecardLine(s), style = LuminaraTextStyles.Body)
        }
    }
}

fun scorecardLine(s: ScorecardSegment): String =
    listOf(
        plural(s.enquiries, "new enquiry", "new enquiries"),
        "${s.qualified} ready for an appraisal",
        plural(s.appraisalsBooked, "appraisal booked", "appraisals booked"),
    ).joinToString(" · ")

private fun plural(
    n: Int,
    one: String,
    many: String,
) = "$n ${if (n == 1) one else many}"

fun segmentLabel(segment: String): String =
    when (segment) {
        "seller_appraisal" -> "Seller"
        "buyer_enquiry" -> "Buyer"
        "landlord_management" -> "Landlord"
        else -> "Other enquiry"
    }

/** Melbourne agencies: times read in Melbourne whatever the phone is set to. */
private val MELBOURNE: ZoneId = ZoneId.of("Australia/Melbourne")
private val WHEN_FORMAT = DateTimeFormatter.ofPattern(
    "EEE d MMM, h:mm a",
    Locale.forLanguageTag("en-AU"),
).withZone(MELBOURNE)
private val DAY_FORMAT = DateTimeFormatter.ofPattern("EEE d MMM", Locale.forLanguageTag("en-AU")).withZone(MELBOURNE)

fun formatMelbourne(epochMs: Long): String = WHEN_FORMAT.format(
    Instant.ofEpochMilli(epochMs),
).replace("AM", "am").replace("PM", "pm")

fun formatDay(epochMs: Long): String = DAY_FORMAT.format(Instant.ofEpochMilli(epochMs))

/** Lead-supplied, so only digits and a leading + reach the dialer: no USSD or call-forward codes. */
fun dialablePhone(raw: String?): String? {
    val digits = raw.orEmpty().filter { it.isDigit() || it == '+' }
    return digits.takeIf { it.length >= MIN_PHONE_DIGITS && it.lastIndexOf('+') <= 0 }
}

/** Lead-supplied, so nothing that could add a cc, bcc or body to the composer. */
fun safeEmail(raw: String?): String? = raw?.trim()?.takeIf { EMAIL.matches(it) }

private const val MIN_PHONE_DIGITS = 6
private val EMAIL = Regex("^[^\\s?&#%@]+@[^\\s?&#%@]+\\.[^\\s?&#%@]+$")

private fun addToCalendar(
    context: Context,
    item: UpcomingItem,
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
