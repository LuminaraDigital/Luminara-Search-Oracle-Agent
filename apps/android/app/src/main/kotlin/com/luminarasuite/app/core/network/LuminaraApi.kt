package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.AccountDeleteRequest
import com.luminarasuite.app.core.model.AccountDeleteResponse
import com.luminarasuite.app.core.model.AppointmentDecisionRequest
import com.luminarasuite.app.core.model.AuditHistoryListResponse
import com.luminarasuite.app.core.model.AuditHistoryUpsertRequest
import com.luminarasuite.app.core.model.AuditHistoryUpsertResponse
import com.luminarasuite.app.core.model.AuditRunRequest
import com.luminarasuite.app.core.model.AuditRunResponse
import com.luminarasuite.app.core.model.AuthCredentialsRequest
import com.luminarasuite.app.core.model.AuthTokenResponse
import com.luminarasuite.app.core.model.BootResponse
import com.luminarasuite.app.core.model.CrawlerFilesResponse
import com.luminarasuite.app.core.model.EnquiryCreateRequest
import com.luminarasuite.app.core.model.EnquiryDeskResponse
import com.luminarasuite.app.core.model.EnquiryTakeoverRequest
import com.luminarasuite.app.core.model.EnquiryTurnRequest
import com.luminarasuite.app.core.model.FindingPatchRequest
import com.luminarasuite.app.core.model.FindingPatchResponse
import com.luminarasuite.app.core.model.FindingsBulkRequest
import com.luminarasuite.app.core.model.FindingsBulkResponse
import com.luminarasuite.app.core.model.FindingsListResponse
import com.luminarasuite.app.core.model.FirecrawlMapRequest
import com.luminarasuite.app.core.model.FirecrawlMapResponse
import com.luminarasuite.app.core.model.FirecrawlScrapeRequest
import com.luminarasuite.app.core.model.FirecrawlScrapeResponse
import com.luminarasuite.app.core.model.GatewayExecuteRequest
import com.luminarasuite.app.core.model.GatewayExecuteResponse
import com.luminarasuite.app.core.model.GoogleSignInRequest
import com.luminarasuite.app.core.model.GroqChatRequest
import com.luminarasuite.app.core.model.GroqChatResponse
import com.luminarasuite.app.core.model.IdeaCreateRequest
import com.luminarasuite.app.core.model.IdeaCreateResponse
import com.luminarasuite.app.core.model.IdeaDetailResponse
import com.luminarasuite.app.core.model.IdeaListResponse
import com.luminarasuite.app.core.model.PrivacyExportResponse
import com.luminarasuite.app.core.model.ProbeCrawlResponse
import com.luminarasuite.app.core.model.ScoutRecheckRequest
import com.luminarasuite.app.core.model.ScoutRecheckResponse
import com.luminarasuite.app.core.model.ShareCreateRequest
import com.luminarasuite.app.core.model.ShareCreateResponse
import com.luminarasuite.app.core.model.SharedReportResponse
import com.luminarasuite.app.core.model.SharedTeaserResponse
import com.luminarasuite.app.core.model.TavilySearchRequest
import com.luminarasuite.app.core.model.TavilySearchResponse
import com.luminarasuite.app.core.model.WorkspacePutRequest
import com.luminarasuite.app.core.model.WorkspacePutResponse
import com.luminarasuite.app.core.model.WorkspaceResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

/**
 * Defaults must reach the wire: the Worker needs flags like recheck and refund, and the relay
 * needs the model and search settings.
 */
val LuminaraWireJson =
    Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
        encodeDefaults = true
    }

/** The Worker refunds only when both scores are explicit nulls, meaning nothing was measured. */
fun auditRefundBody(
    token: String,
    domain: String,
): JsonObject =
    buildJsonObject {
        put("token", token)
        put("domain", domain)
        put("refund", true)
        put("healthScore", JsonNull)
        put("citationRate", JsonNull)
    }

@Suppress("TooManyFunctions") // One method per Worker route.
interface LuminaraApi {
    @GET("api/visibility/probe-crawl")
    suspend fun probeCrawl(
        @Query("url") url: String,
    ): ProbeCrawlResponse

    @GET("api/visibility/crawler-files")
    suspend fun fetchCrawlerFiles(
        @Query("url") url: String,
    ): CrawlerFilesResponse

    @POST("api/gateway/execute")
    suspend fun executeGateway(
        @Body body: GatewayExecuteRequest,
    ): GatewayExecuteResponse

    @POST("api/audit/scout-run")
    suspend fun recheckFix(
        @Body body: ScoutRecheckRequest,
    ): ScoutRecheckResponse

    @POST("api/audit/scout-run")
    suspend fun beginAuditRun(
        @Body body: AuditRunRequest,
    ): AuditRunResponse

    @POST("api/audit/scout-run")
    suspend fun refundAuditRun(
        @Body body: JsonObject,
    ): AuditRunResponse

    @GET("api/audits/history")
    suspend fun getAuditHistory(
        @Query("limit") limit: Int = 25,
    ): AuditHistoryListResponse

    @PUT("api/audits/history")
    suspend fun upsertAuditHistory(
        @Body body: AuditHistoryUpsertRequest,
    ): AuditHistoryUpsertResponse

    @GET("api/findings")
    suspend fun getFindings(
        @Query("domain") domain: String? = null,
    ): FindingsListResponse

    @POST("api/findings/bulk")
    suspend fun createFindingsBulk(
        @Body body: FindingsBulkRequest,
    ): FindingsBulkResponse

    @PATCH("api/findings/{id}")
    suspend fun updateFindingStatus(
        @Path("id") id: String,
        @Body body: FindingPatchRequest,
    ): FindingPatchResponse

    @POST("api/auth/sign-in")
    suspend fun signIn(
        @Body body: AuthCredentialsRequest,
    ): AuthTokenResponse

    @POST("api/auth/sign-up")
    suspend fun signUp(
        @Body body: AuthCredentialsRequest,
    ): AuthTokenResponse

    @POST("api/auth/google")
    suspend fun signInWithGoogle(
        @Body body: GoogleSignInRequest,
    ): AuthTokenResponse

    @GET("api/share/reports/{token}")
    suspend fun getSharedReport(
        @Path("token") token: String,
        @Header("x-share-password") password: String? = null,
    ): SharedReportResponse

    @GET("api/share/teasers/{token}")
    suspend fun getSharedTeaser(
        @Path("token") token: String,
    ): SharedTeaserResponse

    @POST("api/share/reports")
    suspend fun createShare(
        @Body body: ShareCreateRequest,
    ): ShareCreateResponse

    @GET("api/workspace")
    suspend fun getWorkspace(): WorkspaceResponse

    @PUT("api/workspace")
    suspend fun putWorkspace(
        @Body body: WorkspacePutRequest,
    ): WorkspacePutResponse

    @GET("api/enquiries")
    suspend fun getEnquiries(
        @Query("projectId") projectId: String = "default",
    ): EnquiryDeskResponse

    @POST("api/enquiries")
    suspend fun createEnquiry(
        @Body body: EnquiryCreateRequest,
    ): JsonObject

    @POST("api/enquiries/{id}/turn")
    suspend fun enquiryTurn(
        @Path("id") id: String,
        @Body body: EnquiryTurnRequest,
    ): JsonObject

    @POST("api/enquiries/{id}/takeover")
    suspend fun enquiryTakeover(
        @Path("id") id: String,
        @Body body: EnquiryTakeoverRequest,
    ): JsonObject

    @POST("api/enquiries/appointments/{id}/decision")
    suspend fun decideAppointment(
        @Path("id") id: String,
        @Body body: AppointmentDecisionRequest,
    ): JsonObject

    @GET("api/boot")
    suspend fun getAccountBoot(): BootResponse

    @POST("api/privacy/account")
    suspend fun deleteAccount(
        @Body body: AccountDeleteRequest,
    ): AccountDeleteResponse

    @POST("api/privacy/export")
    suspend fun requestDataExport(): PrivacyExportResponse

    @POST("api/providers/tavily/search")
    suspend fun searchTavily(
        @Header("x-provider-key") providerKey: String? = null,
        @Header("x-audit-run") auditRun: String? = null,
        @Header("x-audit-domain") auditDomain: String? = null,
        @Body body: TavilySearchRequest,
    ): TavilySearchResponse

    @POST("api/providers/firecrawl/map")
    suspend fun firecrawlMap(
        @Header("x-audit-run") auditRun: String,
        @Header("x-audit-domain") auditDomain: String,
        @Body body: FirecrawlMapRequest,
    ): FirecrawlMapResponse

    @POST("api/providers/firecrawl/scrape")
    suspend fun firecrawlScrape(
        @Header("x-audit-run") auditRun: String,
        @Header("x-audit-domain") auditDomain: String,
        @Body body: FirecrawlScrapeRequest,
    ): FirecrawlScrapeResponse

    @POST("api/providers/groq/chat/completions")
    suspend fun chatGroq(
        @Header("x-provider-key") providerKey: String? = null,
        @Header("x-accept-fallback") acceptFallback: String = "true",
        @Header("x-audit-run") auditRun: String? = null,
        @Header("x-audit-domain") auditDomain: String? = null,
        @Body body: GroqChatRequest,
    ): GroqChatResponse

    @Streaming
    @POST("api/providers/groq/chat/completions")
    suspend fun streamGroq(
        @Header("x-provider-key") providerKey: String? = null,
        @Header("x-accept-fallback") acceptFallback: String = "true",
        @Body body: GroqChatRequest,
    ): ResponseBody

    @GET("api/idea-scout")
    suspend fun listIdeas(): IdeaListResponse

    @POST("api/idea-scout")
    suspend fun createIdea(
        @Header("x-provider-key") providerKey: String? = null,
        @Body body: IdeaCreateRequest,
    ): IdeaCreateResponse

    @GET("api/idea-scout/{id}")
    suspend fun getIdea(
        @Path("id") id: String,
    ): IdeaDetailResponse
}
