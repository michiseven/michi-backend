package com.michiseven.michi.admin.members

import kotlinx.serialization.Serializable

@Serializable
data class MemberListItemDto(
    val id: String,
    val displayName: String,
    val email: String,
    val locale: String,
    val status: String,
    val savedTripCount: Long,
    val latestSavedAt: String?,
    val createdAt: String,
    val updatedAt: String
)

data class MemberFilter(
    val query: String? = null,
    val locale: String? = null,
    val status: String? = null
)
