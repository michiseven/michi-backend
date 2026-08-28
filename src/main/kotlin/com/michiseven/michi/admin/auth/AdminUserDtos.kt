package com.michiseven.michi.admin.auth

import kotlinx.serialization.Serializable

@Serializable
data class InviteAdminUserRequest(
    val email: String,
    val displayName: String,
    val role: String
)

@Serializable
data class UpdateAdminUserRoleRequest(
    val role: String
)

@Serializable
data class UpdateAdminUserStatusRequest(
    val status: String
)

@Serializable
data class AdminUserDetailResponse(
    val id: String,
    val email: String,
    val displayName: String,
    val role: String,
    val status: String,
    val authProvider: String,
    val lastLoginAt: String?,
    val createdAt: String,
    val createdBy: String?
)

data class AdminUserFilter(
    val query: String? = null,
    val role: String? = null,
    val status: String? = null
)
