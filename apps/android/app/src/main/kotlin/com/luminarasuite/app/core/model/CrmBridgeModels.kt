package com.luminarasuite.app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class CrmBridgeLink(
    val workspaceSlug: String = "",
    val crmBaseUrl: String = "",
    val crmMode: String = "standalone",
    val primaryExternalCrm: String? = null,
    val status: String = "active",
)

@Serializable
data class CrmBridgeStatus(
    val ok: Boolean = false,
    val enabled: Boolean = false,
    val activated: Boolean = false,
    val link: CrmBridgeLink? = null,
)

@Serializable
data class CrmPromoteResponse(
    val ok: Boolean = false,
    val duplicate: Boolean = false,
    val crmLeadId: String = "",
    val crmReceiptCode: String? = null,
    val status: String = "",
)

@Serializable
data class CrmApprovalDecisionRequest(
    val decision: String,
    val feedbackNote: String? = null,
)
