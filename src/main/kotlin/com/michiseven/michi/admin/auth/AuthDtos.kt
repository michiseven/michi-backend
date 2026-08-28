package com.michiseven.michi.admin.auth

import kotlinx.serialization.Serializable

@Serializable
data class AdminLoginRequest(
    val email: String,
    val password: String
)

@Serializable
data class AdminUserResponse(
    val id: String,
    val email: String,
    val displayName: String,
    val role: String,
    val status: String
)

@Serializable
data class AdminLoginResponse(
    val user: AdminUserResponse,
    val expiresAt: String
)

@Serializable
data class AdminLogoutResponse(val loggedOut: Boolean = true)

data class AdminUserRecord(
    val id: String,
    val email: String,
    val displayName: String,
    val passwordHash: String?,
    val role: String,
    val status: String
) {
    fun toResponse() = AdminUserResponse(id, email, displayName, role, status)
}

data class CreatedAdminSession(
    val user: AdminUserResponse,
    val rawToken: String,
    val expiresAt: String
)
