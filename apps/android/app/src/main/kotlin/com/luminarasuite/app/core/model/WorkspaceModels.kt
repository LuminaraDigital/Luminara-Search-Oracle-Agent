package com.luminarasuite.app.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import java.net.URI

@Serializable
data class GoogleSignInRequest(
    val googleIdToken: String,
)

/** A public link this app can open: /share/<token> or /share/teaser/<token>. */
data class ShareLink(
    val token: String,
    val isTeaser: Boolean,
) {
    companion object {
        private val TOKEN = Regex("^[A-Za-z0-9_-]{16,128}$")

        fun parse(url: String?): ShareLink? {
            val path = runCatching { URI(url.orEmpty()) }.getOrNull()?.takeIf { it.scheme == "https" }?.path.orEmpty()
            val parts = path.split('/').filter { it.isNotEmpty() }
            val link =
                when {
                    parts.size == 2 && parts[0] == "share" -> ShareLink(parts[1], isTeaser = false)
                    parts.size == 3 && parts[0] == "share" && parts[1] == "teaser" -> ShareLink(
                        parts[2],
                        isTeaser = true,
                    )
                    else -> return null
                }
            return link.takeIf { TOKEN.matches(it.token) }
        }
    }
}

@Serializable
data class ShareSource(
    val uri: String = "",
    val title: String = "",
)

@Serializable
data class SharedReportBody(
    val domain: String? = null,
    val markdownText: String = "",
    val sources: List<ShareSource> = emptyList(),
    val passwordRequired: Boolean = false,
)

@Serializable
data class SharedReportResponse(
    val ok: Boolean = false,
    val report: SharedReportBody? = null,
)

@Serializable
data class TeaserCheck(
    val label: String = "",
    val status: String = "not_measured",
    val detail: String = "",
)

@Serializable
data class SharedTeaserBody(
    val domain: String = "",
    val verdict: String = "",
    val topFix: String = "",
    val evidenceNote: String = "",
    val crawlerChecks: List<TeaserCheck> = emptyList(),
)

@Serializable
data class SharedTeaserResponse(
    val ok: Boolean = false,
    val teaser: SharedTeaserBody? = null,
)

/** What the viewer shows, whichever kind of link was opened. */
data class SharedDocument(
    val title: String,
    val body: String,
    val sources: List<ShareSource> = emptyList(),
)

@Serializable
data class ShareCreateRequest(
    val markdownText: String,
    val domain: String? = null,
)

@Serializable
data class ShareCreateResponse(
    val ok: Boolean = false,
    val url: String = "",
)

@Serializable
data class BusinessDna(
    val name: String = "",
    val mission: String = "",
    val usp: String = "",
    val targetAudience: String = "",
    val competitors: List<String> = emptyList(),
    val perceivedGaps: List<String> = emptyList(),
    val rawContext: String = "",
    val industry: String? = null,
    val suburb: String? = null,
    val state: String? = null,
)

@Serializable
data class WorkspaceResponse(
    val ok: Boolean = false,
    val updatedAt: Long = 0L,
    val payload: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class WorkspacePutRequest(
    val baseVersion: Long,
    val payload: JsonObject,
)

@Serializable
data class WorkspacePutResponse(
    val ok: Boolean = false,
    val updatedAt: Long = 0L,
)

@Serializable
data class EnquiryMessage(
    val id: String = "",
    val sender: String = "",
    val text: String = "",
    val timestamp: Long = 0L,
)

@Serializable
data class EnquiryRecord(
    val id: String,
    val contactName: String = "",
    val contactEmail: String? = null,
    val contactPhone: String? = null,
    val propertyAddress: String? = null,
    val intentType: String = "",
    val status: String = "new",
    val automationPaused: Boolean = false,
    val conversation: List<EnquiryMessage> = emptyList(),
    val updatedAt: Long = 0L,
    val qualificationBrief: QualificationBrief = QualificationBrief(),
)

@Serializable
data class QualificationBrief(
    val qualified: Boolean = false,
    val missingRequiredFields: List<String> = emptyList(),
)

@Serializable
data class BookingSlot(
    val slotId: String = "",
    val label: String = "",
    val startAt: Long = 0L,
    val endAt: Long = 0L,
)

@Serializable
data class AppointmentRecord(
    val id: String,
    val enquiryId: String = "",
    val proposedSlots: List<BookingSlot> = emptyList(),
    val approvalStatus: String = "",
)

@Serializable
data class EnquiryDeskResponse(
    val ok: Boolean = false,
    val enquiries: List<EnquiryRecord> = emptyList(),
    val appointments: List<AppointmentRecord> = emptyList(),
)

@Serializable
data class EnquiryCreateRequest(
    val fullName: String,
    val initialMessage: String,
    val email: String? = null,
    val phoneE164: String? = null,
    val projectId: String = "default",
    val sourceChannel: String = "manual",
    val intentType: String = "general_sme",
    val propertyAddress: String? = null,
)

@Serializable
data class EnquiryTurnRequest(
    val sender: String,
    val text: String,
)

@Serializable
data class EnquiryTakeoverRequest(
    val paused: Boolean,
)

@Serializable
data class AppointmentDecisionRequest(
    val decision: String,
    val selectedSlotId: String? = null,
)

/** What every person on the agent's Today screen has, whichever list they are in. */
interface TodayPerson {
    val enquiryId: String
    val name: String
    val phone: String?
    val email: String?
    val address: String?
    val segment: String
}

@Serializable
data class SignOffItem(
    override val enquiryId: String = "",
    override val name: String = "",
    override val phone: String? = null,
    override val email: String? = null,
    override val address: String? = null,
    override val segment: String = "",
    val appointmentId: String = "",
    val slots: List<BookingSlot> = emptyList(),
) : TodayPerson

@Serializable
data class CallBackItem(
    override val enquiryId: String = "",
    override val name: String = "",
    override val phone: String? = null,
    override val email: String? = null,
    override val address: String? = null,
    override val segment: String = "",
    val reason: String = "",
) : TodayPerson

@Serializable
data class UpcomingItem(
    override val enquiryId: String = "",
    override val name: String = "",
    override val phone: String? = null,
    override val email: String? = null,
    override val address: String? = null,
    override val segment: String = "",
    val appointmentId: String = "",
    val startAt: Long = 0L,
    val endAt: Long = 0L,
) : TodayPerson

@Serializable
data class ScorecardSegment(
    val segment: String = "",
    val label: String = "",
    val enquiries: Int = 0,
    val qualified: Int = 0,
    val appraisalsBooked: Int = 0,
)

@Serializable
data class Scorecard(
    val since: Long = 0L,
    val until: Long = 0L,
    val segments: List<ScorecardSegment> = emptyList(),
)

@Serializable
data class AgentTodayResponse(
    val ok: Boolean = false,
    val needsSignOff: List<SignOffItem> = emptyList(),
    val callBack: List<CallBackItem> = emptyList(),
    val upcoming: List<UpcomingItem> = emptyList(),
    val scorecard: Scorecard = Scorecard(),
)

@Serializable
data class PushDeviceRequest(
    val token: String,
    val platform: String = "android",
)
