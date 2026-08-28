package com.michiseven.michi.admin.members

import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import com.michiseven.michi.admin.database.withReadOnlyConnection
import java.sql.ResultSet
import javax.sql.DataSource

class MemberRepository(private val dataSource: DataSource) {
    companion object {
        val ALLOWED_SORTS = mapOf(
            "createdAt" to "u.created_at",
            "displayName" to "u.display_name",
            "email" to "u.email",
            "savedTrips" to "saved_trip_count"
        )
    }

    fun findMembers(filter: MemberFilter, pageRequest: PageRequest): PageResponse<MemberListItemDto> {
        return dataSource.withReadOnlyConnection { conn ->
            val clauses = mutableListOf<String>()
            val params = mutableListOf<Any>()

            if (!filter.query.isNullOrBlank()) {
                val query = "%${filter.query.trim()}%"
                clauses += "(u.display_name ILIKE ? OR u.email ILIKE ?)"
                params += query
                params += query
            }
            if (!filter.locale.isNullOrBlank() && filter.locale != "all") {
                clauses += "u.locale = ?"
                params += filter.locale.trim().lowercase()
            }
            when (filter.status?.lowercase()) {
                "active" -> clauses += "u.is_active = true"
                "inactive" -> clauses += "u.is_active = false"
            }

            val whereSql = if (clauses.isEmpty()) "" else "WHERE ${clauses.joinToString(" AND ")}"
            val totalItems = conn.prepareStatement("SELECT COUNT(*) FROM users u $whereSql").use { stmt ->
                params.forEachIndexed { index, value -> stmt.setObject(index + 1, value) }
                stmt.executeQuery().use { rs -> if (rs.next()) rs.getLong(1) else 0L }
            }

            val sortColumn = ALLOWED_SORTS[pageRequest.sort] ?: "u.created_at"
            val sql = """
                SELECT
                    u.id,
                    u.display_name,
                    u.email,
                    u.locale,
                    u.is_active,
                    u.created_at,
                    u.updated_at,
                    COUNT(ust.id) AS saved_trip_count,
                    MAX(ust.saved_at) AS latest_saved_at
                FROM users u
                LEFT JOIN user_saved_trips ust ON ust.user_id = u.id
                $whereSql
                GROUP BY u.id
                ORDER BY $sortColumn ${pageRequest.direction.sql}, u.id
                LIMIT ? OFFSET ?
            """.trimIndent()

            val items = mutableListOf<MemberListItemDto>()
            conn.prepareStatement(sql).use { stmt ->
                var index = 1
                params.forEach { value -> stmt.setObject(index++, value) }
                stmt.setInt(index++, pageRequest.pageSize)
                stmt.setLong(index, pageRequest.offset)
                stmt.executeQuery().use { rs ->
                    while (rs.next()) items += mapMember(rs)
                }
            }

            PageResponse(
                items = items,
                page = pageRequest.page,
                pageSize = pageRequest.pageSize,
                totalItems = totalItems,
                totalPages = if (totalItems == 0L) 0 else ((totalItems + pageRequest.pageSize - 1) / pageRequest.pageSize).toInt()
            )
        }
    }

    private fun mapMember(rs: ResultSet): MemberListItemDto {
        return MemberListItemDto(
            id = rs.getString("id"),
            displayName = rs.getString("display_name"),
            email = rs.getString("email"),
            locale = rs.getString("locale"),
            status = if (rs.getBoolean("is_active")) "active" else "inactive",
            savedTripCount = rs.getLong("saved_trip_count"),
            latestSavedAt = rs.getTimestamp("latest_saved_at")?.toInstant()?.toString(),
            createdAt = rs.getTimestamp("created_at").toInstant().toString(),
            updatedAt = rs.getTimestamp("updated_at").toInstant().toString()
        )
    }
}
