package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.AgentTodayResponse
import com.luminarasuite.app.core.model.AppointmentDecisionRequest
import com.luminarasuite.app.core.model.BusinessDna
import com.luminarasuite.app.core.model.EnquiryCreateRequest
import com.luminarasuite.app.core.model.EnquiryDeskResponse
import com.luminarasuite.app.core.model.EnquiryTakeoverRequest
import com.luminarasuite.app.core.model.EnquiryTurnRequest
import com.luminarasuite.app.core.model.PushDeviceRequest
import com.luminarasuite.app.core.model.ShareCreateRequest
import com.luminarasuite.app.core.model.ShareLink
import com.luminarasuite.app.core.model.SharedDocument
import com.luminarasuite.app.core.model.WorkerErrorPayload
import com.luminarasuite.app.core.model.WorkspacePutRequest
import com.luminarasuite.app.core.model.WorkspaceResponse
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import retrofit2.HttpException

class SharePasswordRequired : IllegalStateException("This report needs its password.")

/** Account surfaces beyond the audit: shared links, Business Profile, and the Enquiry Desk. */
interface WorkspaceGateway {
    suspend fun openShared(
        link: ShareLink,
        password: String?,
    ): Result<SharedDocument>

    suspend fun createShareLink(
        text: String,
        domain: String?,
    ): Result<String>

    suspend fun loadProfile(): Result<BusinessDna>

    suspend fun saveProfile(profile: BusinessDna): Result<Unit>

    suspend fun loadEnquiries(): Result<EnquiryDeskResponse>

    suspend fun createEnquiry(request: EnquiryCreateRequest): Result<Unit>

    suspend fun replyToEnquiry(
        id: String,
        text: String,
    ): Result<Unit>

    suspend fun setEnquiryPaused(
        id: String,
        paused: Boolean,
    ): Result<Unit>

    suspend fun decideAppointment(
        id: String,
        approve: Boolean,
        slotId: String?,
    ): Result<Unit>

    suspend fun loadToday(): Result<AgentTodayResponse>

    suspend fun registerPushToken(token: String): Result<Unit>
}

class DefaultWorkspaceGateway(
    private val api: LuminaraApi,
) : WorkspaceGateway {
    companion object {
        private const val STORAGE = "storage"
        private const val DNA_KEY = "luminara_business_dna"
        private const val HTTP_CONFLICT = 409
    }

    override suspend fun openShared(
        link: ShareLink,
        password: String?,
    ): Result<SharedDocument> =
        safely {
            if (link.isTeaser) {
                val teaser = api.getSharedTeaser(link.token).teaser ?: error("This link is no longer available.")
                val checks = teaser.crawlerChecks.joinToString("\n") { "${it.label}: ${it.status}. ${it.detail}" }
                SharedDocument(
                    title = teaser.domain,
                    body = listOf(teaser.verdict, teaser.topFix, checks, teaser.evidenceNote)
                        .filter { it.isNotBlank() }
                        .joinToString("\n\n"),
                )
            } else {
                val report =
                    api.getSharedReport(link.token, password).report ?: error("This link is no longer available.")
                SharedDocument(
                    title = report.domain ?: "Shared report",
                    body = report.markdownText,
                    sources = report.sources,
                )
            }
        }

    override suspend fun createShareLink(
        text: String,
        domain: String?,
    ): Result<String> =
        safely {
            api.createShare(ShareCreateRequest(markdownText = text, domain = domain)).url.ifBlank {
                error("The link could not be created.")
            }
        }

    override suspend fun loadProfile(): Result<BusinessDna> =
        safely {
            val stored = storedDna(api.getWorkspace().payload)
            stored?.let { LuminaraWireJson.decodeFromJsonElement(BusinessDna.serializer(), it) } ?: BusinessDna()
        }

    override suspend fun saveProfile(profile: BusinessDna): Result<Unit> =
        safely {
            try {
                writeProfile(profile)
            } catch (err: HttpException) {
                // Another device saved first. Merge onto its copy once.
                if (err.code() != HTTP_CONFLICT) throw err
                writeProfile(profile)
            }
        }

    /** PUT replaces the whole workspace, so everything the other surfaces stored is written back. */
    private suspend fun writeProfile(profile: BusinessDna) {
        val current: WorkspaceResponse = api.getWorkspace()
        val edited = LuminaraWireJson.encodeToJsonElement(BusinessDna.serializer(), profile).jsonObject
        val merged = JsonObject(storedDna(current.payload).orEmpty() + edited)
        val storage = current.payload[STORAGE] as? JsonObject ?: JsonObject(emptyMap())
        val payload =
            JsonObject(
                current.payload +
                    (STORAGE to JsonObject(storage + (DNA_KEY to JsonPrimitive(merged.toString())))),
            )
        api.putWorkspace(WorkspacePutRequest(baseVersion = current.updatedAt, payload = payload))
    }

    /** The web client stores this value as a JSON string inside the workspace. */
    private fun storedDna(payload: JsonObject): JsonObject? {
        val raw = ((payload[STORAGE] as? JsonObject)?.get(DNA_KEY) as? JsonPrimitive)?.contentOrNull
        return raw?.let { runCatching { LuminaraWireJson.parseToJsonElement(it).jsonObject }.getOrNull() }
    }

    override suspend fun loadEnquiries(): Result<EnquiryDeskResponse> = safely { api.getEnquiries() }

    override suspend fun createEnquiry(request: EnquiryCreateRequest): Result<Unit> =
        safely {
            api.createEnquiry(request)
            Unit
        }

    override suspend fun replyToEnquiry(
        id: String,
        text: String,
    ): Result<Unit> =
        safely {
            api.enquiryTurn(id, EnquiryTurnRequest(sender = "agent", text = text))
            Unit
        }

    override suspend fun setEnquiryPaused(
        id: String,
        paused: Boolean,
    ): Result<Unit> =
        safely {
            api.enquiryTakeover(id, EnquiryTakeoverRequest(paused = paused))
            Unit
        }

    override suspend fun decideAppointment(
        id: String,
        approve: Boolean,
        slotId: String?,
    ): Result<Unit> =
        safely {
            api.decideAppointment(
                id,
                AppointmentDecisionRequest(decision = if (approve) "approve" else "decline", selectedSlotId = slotId),
            )
            Unit
        }

    override suspend fun loadToday(): Result<AgentTodayResponse> = safely { api.getAgentToday() }

    override suspend fun registerPushToken(token: String): Result<Unit> =
        safely {
            api.registerPushDevice(PushDeviceRequest(token = token))
            Unit
        }

    private inline fun <T> safely(block: () -> T): Result<T> =
        runCatching(block)
            .onFailure { if (it is CancellationException) throw it }
            .recoverCatching { throw friendly(it) }

    private fun friendly(err: Throwable): Throwable {
        if (err !is HttpException) return err
        val raw = runCatching { err.response()?.errorBody()?.string() }.getOrNull().orEmpty()
        val parsed = runCatching { LuminaraWireJson.decodeFromString<WorkerErrorPayload>(raw) }.getOrNull()
        return when {
            parsed?.code == "SHARE_PASSWORD_REQUIRED" || parsed?.code == "SHARE_PASSWORD_INVALID" ->
                SharePasswordRequired()
            parsed?.code in setOf("SHARE_EXPIRED", "SHARE_NOT_FOUND", "TEASER_NOT_FOUND") ->
                IllegalStateException("This link is no longer available.")
            !parsed?.error.isNullOrBlank() -> IllegalStateException(parsed?.error)
            else -> err
        }
    }
}
