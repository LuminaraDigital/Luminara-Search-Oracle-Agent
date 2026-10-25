package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.AccountDeleteRequest
import com.luminarasuite.app.core.model.AccountDeleteResponse
import com.luminarasuite.app.core.model.AuditHistoryListResponse
import com.luminarasuite.app.core.model.AuditHistoryUpsertRequest
import com.luminarasuite.app.core.model.AuditHistoryUpsertResponse
import com.luminarasuite.app.core.model.AuthCredentialsRequest
import com.luminarasuite.app.core.model.AuthTokenResponse
import com.luminarasuite.app.core.model.BootResponse
import com.luminarasuite.app.core.model.CrawlerFilesResponse
import com.luminarasuite.app.core.model.FindingPatchRequest
import com.luminarasuite.app.core.model.FindingPatchResponse
import com.luminarasuite.app.core.model.FindingsBulkRequest
import com.luminarasuite.app.core.model.FindingsBulkResponse
import com.luminarasuite.app.core.model.FindingsListResponse
import com.luminarasuite.app.core.model.GatewayExecuteRequest
import com.luminarasuite.app.core.model.GatewayExecuteResponse
import com.luminarasuite.app.core.model.GroqChatRequest
import com.luminarasuite.app.core.model.GroqChatResponse
import com.luminarasuite.app.core.model.PrivacyExportResponse
import com.luminarasuite.app.core.model.ProbeCrawlResponse
import com.luminarasuite.app.core.model.ScoutRecheckRequest
import com.luminarasuite.app.core.model.ScoutRecheckResponse
import com.luminarasuite.app.core.model.TavilySearchRequest
import com.luminarasuite.app.core.model.TavilySearchResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

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
        @Body body: TavilySearchRequest,
    ): TavilySearchResponse

    @POST("api/providers/groq/chat/completions")
    suspend fun chatGroq(
        @Header("x-provider-key") providerKey: String? = null,
        @Header("x-accept-fallback") acceptFallback: String = "true",
        @Body body: GroqChatRequest,
    ): GroqChatResponse
}
