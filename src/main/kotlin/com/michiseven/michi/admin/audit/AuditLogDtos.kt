package com.michiseven.michi.admin.audit

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class AdminAuditLogResponse(
    val id: String,
    val adminUserId: String?,
    val adminUserEmail: String?,
    val adminUserDisplayName: String?,
    val action: String,
    val resourceType: String,
    val resourceId: String?,
    val result: String,
    val requestId: String?,
    val ipAddress: String?,
    val beforeData: JsonElement? = null,
    val afterData: JsonElement? = null,
    val metadata: JsonElement? = null,
    val createdAt: String
)

data class AuditLogFilter(
    val adminUserId: String? = null,
    val action: String? = null,
    val resourceType: String? = null,
    val result: String? = null,
    val requestId: String? = null,
    val dateFrom: String? = null,
    val dateTo: String? = null
)
