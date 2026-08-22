package com.michiseven.michi.admin.common

import kotlinx.serialization.Serializable

@Serializable
data class PageResponse<T>(
    val items: List<T>,
    val page: Int,
    val pageSize: Int,
    val totalItems: Long,
    val totalPages: Int
)

data class PageRequest(
    val page: Int,
    val pageSize: Int,
    val sort: String? = null,
    val direction: SortDirection = SortDirection.DESC
) {
    val offset: Long get() = ((page - 1).coerceAtLeast(0).toLong()) * pageSize

    companion object {
        fun of(
            page: Int?,
            pageSize: Int?,
            sort: String?,
            direction: String?,
            allowedSorts: Set<String>,
            defaultSort: String = "updatedAt"
        ): PageRequest {
            val safePage = (page ?: 1).coerceAtLeast(1)
            val safePageSize = (pageSize ?: 20).coerceIn(1, 100)
            val cleanSort = sort?.trim()
            val validatedSort = if (cleanSort != null && cleanSort in allowedSorts) cleanSort else defaultSort
            val safeDirection = if (direction?.equals("asc", ignoreCase = true) == true) {
                SortDirection.ASC
            } else {
                SortDirection.DESC
            }
            return PageRequest(safePage, safePageSize, validatedSort, safeDirection)
        }
    }
}

enum class SortDirection {
    ASC, DESC;

    val sql: String get() = name
}
