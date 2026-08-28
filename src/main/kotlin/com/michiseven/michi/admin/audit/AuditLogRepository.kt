package com.michiseven.michi.admin.audit

import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.sql.ResultSet
import java.sql.Timestamp
import java.sql.Types
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

class AuditLogRepository(
    private val dataSource: DataSource,
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    companion object {
        val ALLOWED_SORTS = mapOf(
            "createdAt" to "l.created_at",
            "action" to "l.action",
            "resourceType" to "l.resource_type",
            "result" to "l.result"
        )
    }

    fun findAuditLogs(
        filter: AuditLogFilter,
        pageRequest: PageRequest
    ): PageResponse<AdminAuditLogResponse> = dataSource.connection.use { conn ->
        val whereClauses = mutableListOf<String>()
        val params = mutableListOf<Any>()

        if (!filter.adminUserId.isNullOrBlank()) {
            val userUuid = try {
                UUID.fromString(filter.adminUserId)
            } catch (_: Exception) {
                null
            }
            if (userUuid != null) {
                whereClauses.add("l.admin_user_id = ?")
                params.add(userUuid)
            }
        }

        if (!filter.action.isNullOrBlank()) {
            whereClauses.add("l.action ILIKE ?")
            params.add("%${filter.action.trim()}%")
        }

        if (!filter.resourceType.isNullOrBlank()) {
            whereClauses.add("l.resource_type = ?")
            params.add(filter.resourceType.trim())
        }

        if (!filter.result.isNullOrBlank()) {
            whereClauses.add("l.result = ?")
            params.add(filter.result.trim())
        }

        if (!filter.requestId.isNullOrBlank()) {
            whereClauses.add("l.request_id = ?")
            params.add(filter.requestId.trim())
        }

        if (!filter.dateFrom.isNullOrBlank()) {
            try {
                val fromInstant = Instant.parse(filter.dateFrom)
                whereClauses.add("l.created_at >= ?")
                params.add(Timestamp.from(fromInstant))
            } catch (_: Exception) {
            }
        }

        if (!filter.dateTo.isNullOrBlank()) {
            try {
                val toInstant = Instant.parse(filter.dateTo)
                whereClauses.add("l.created_at <= ?")
                params.add(Timestamp.from(toInstant))
            } catch (_: Exception) {
            }
        }

        val whereSql = if (whereClauses.isEmpty()) "" else "WHERE " + whereClauses.joinToString(" AND ")

        val countSql = "SELECT COUNT(*) FROM admin.admin_audit_logs l $whereSql"
        val totalItems = conn.prepareStatement(countSql).use { stmt ->
            params.forEachIndexed { index, param ->
                stmt.setObject(index + 1, param)
            }
            stmt.executeQuery().use { rs ->
                if (rs.next()) rs.getLong(1) else 0L
            }
        }

        val sortCol = ALLOWED_SORTS[pageRequest.sort] ?: "l.created_at"
        val sortDir = pageRequest.direction.sql

        val querySql = """
            SELECT
                l.id,
                l.admin_user_id,
                u.email AS user_email,
                u.display_name AS user_display_name,
                l.action,
                l.resource_type,
                l.resource_id,
                l.result,
                l.request_id,
                l.ip_address::text AS ip_address_text,
                l.before_data::text AS before_data_text,
                l.after_data::text AS after_data_text,
                l.metadata::text AS metadata_text,
                l.created_at
            FROM admin.admin_audit_logs l
            LEFT JOIN admin.admin_users u ON u.id = l.admin_user_id
            $whereSql
            ORDER BY $sortCol $sortDir
            LIMIT ? OFFSET ?
        """.trimIndent()

        val items = conn.prepareStatement(querySql).use { stmt ->
            var paramIdx = 1
            params.forEach { param ->
                stmt.setObject(paramIdx++, param)
            }
            stmt.setInt(paramIdx++, pageRequest.pageSize)
            stmt.setLong(paramIdx, pageRequest.offset)

            stmt.executeQuery().use { rs ->
                val list = mutableListOf<AdminAuditLogResponse>()
                while (rs.next()) {
                    list.add(mapAuditLog(rs))
                }
                list
            }
        }

        val totalPages = if (pageRequest.pageSize > 0) {
            ((totalItems + pageRequest.pageSize - 1) / pageRequest.pageSize).toInt()
        } else 0

        PageResponse(
            items = items,
            page = pageRequest.page,
            pageSize = pageRequest.pageSize,
            totalItems = totalItems,
            totalPages = totalPages
        )
    }

    fun recordAudit(
        userId: String?,
        action: String,
        resourceType: String,
        resourceId: String?,
        result: String,
        requestId: String,
        ipAddress: String?,
        beforeData: String? = null,
        afterData: String? = null,
        metadata: String? = null
    ) {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """
                INSERT INTO admin.admin_audit_logs (
                    admin_user_id, action, resource_type, resource_id, result, request_id, ip_address,
                    before_data, after_data, metadata
                ) VALUES (
                    ?::uuid, ?, ?, ?, ?, ?, ?::inet,
                    ?::jsonb, ?::jsonb, COALESCE(?::jsonb, '{}'::jsonb)
                )
                """.trimIndent()
            ).use { stmt ->
                if (userId == null) stmt.setNull(1, Types.VARCHAR) else stmt.setString(1, userId)
                stmt.setString(2, action)
                stmt.setString(3, resourceType)
                if (resourceId == null) stmt.setNull(4, Types.VARCHAR) else stmt.setString(4, resourceId)
                stmt.setString(5, result)
                stmt.setString(6, requestId)
                if (ipAddress == null) stmt.setNull(7, Types.VARCHAR) else stmt.setString(7, ipAddress)
                if (beforeData == null) stmt.setNull(8, Types.VARCHAR) else stmt.setString(8, beforeData)
                if (afterData == null) stmt.setNull(9, Types.VARCHAR) else stmt.setString(9, afterData)
                if (metadata == null) stmt.setNull(10, Types.VARCHAR) else stmt.setString(10, metadata)
                stmt.executeUpdate()
            }
        }
    }

    private fun mapAuditLog(rs: ResultSet): AdminAuditLogResponse {
        val beforeStr = rs.getString("before_data_text")
        val afterStr = rs.getString("after_data_text")
        val metaStr = rs.getString("metadata_text")

        return AdminAuditLogResponse(
            id = rs.getString("id"),
            adminUserId = rs.getString("admin_user_id"),
            adminUserEmail = rs.getString("user_email"),
            adminUserDisplayName = rs.getString("user_display_name"),
            action = rs.getString("action"),
            resourceType = rs.getString("resource_type"),
            resourceId = rs.getString("resource_id"),
            result = rs.getString("result"),
            requestId = rs.getString("request_id"),
            ipAddress = rs.getString("ip_address_text"),
            beforeData = beforeStr?.let { safeParseJson(it) },
            afterData = afterStr?.let { safeParseJson(it) },
            metadata = metaStr?.let { safeParseJson(it) },
            createdAt = rs.getTimestamp("created_at").toInstant().toString()
        )
    }

    private fun safeParseJson(str: String): JsonElement? {
        return try {
            json.parseToJsonElement(str)
        } catch (_: Exception) {
            null
        }
    }
}
