package com.michiseven.michi.admin.auth

import com.michiseven.michi.admin.common.ConflictException
import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import com.michiseven.michi.admin.common.ResourceNotFoundException
import java.sql.ResultSet
import java.sql.Timestamp
import java.sql.Types
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

interface AuthStore {
    fun findUserByEmail(email: String): AdminUserRecord?
    fun findUserById(id: String): AdminUserRecord?
    fun findUsers(filter: AdminUserFilter, pageRequest: PageRequest): PageResponse<AdminUserDetailResponse>
    fun createSession(userId: String, tokenHash: String, expiresAt: Instant)
    fun findUserBySessionTokenHash(tokenHash: String): AdminUserRecord?
    fun revokeSession(tokenHash: String): String?
    fun revokeAllSessionsForUser(userId: String): Int
    fun inviteUser(email: String, displayName: String, role: String, createdBy: String?): AdminUserDetailResponse
    fun updateUserRole(userId: String, newRole: String)
    fun updateUserStatus(userId: String, newStatus: String)
    fun recordAudit(
        userId: String?,
        action: String,
        result: String,
        requestId: String,
        ipAddress: String?,
        resourceType: String = "admin_session",
        resourceId: String? = null,
        beforeData: String? = null,
        afterData: String? = null,
        metadata: String? = null
    )
    fun bootstrapOwner(email: String, displayName: String, passwordHash: String): Boolean
}

class AuthRepository(private val dataSource: DataSource) : AuthStore {
    companion object {
        val ALLOWED_SORTS = mapOf(
            "createdAt" to "created_at",
            "email" to "email",
            "displayName" to "display_name",
            "role" to "role",
            "status" to "status",
            "lastLoginAt" to "last_login_at"
        )
    }

    override fun findUserByEmail(email: String): AdminUserRecord? = dataSource.connection.use { connection ->
        connection.prepareStatement(
            """
            SELECT id, email, display_name, password_hash, role, status
            FROM admin.admin_users
            WHERE LOWER(email) = LOWER(?)
            LIMIT 1
            """.trimIndent()
        ).use { statement ->
            statement.setString(1, email)
            statement.executeQuery().use { resultSet ->
                if (!resultSet.next()) return@use null
                AdminUserRecord(
                    id = resultSet.getString("id"),
                    email = resultSet.getString("email"),
                    displayName = resultSet.getString("display_name"),
                    passwordHash = resultSet.getString("password_hash"),
                    role = resultSet.getString("role"),
                    status = resultSet.getString("status")
                )
            }
        }
    }

    override fun findUserById(id: String): AdminUserRecord? = dataSource.connection.use { connection ->
        val userUuid = try {
            UUID.fromString(id)
        } catch (_: Exception) {
            return@use null
        }
        connection.prepareStatement(
            """
            SELECT id, email, display_name, password_hash, role, status
            FROM admin.admin_users
            WHERE id = ?
            LIMIT 1
            """.trimIndent()
        ).use { statement ->
            statement.setObject(1, userUuid)
            statement.executeQuery().use { resultSet ->
                if (!resultSet.next()) return@use null
                AdminUserRecord(
                    id = resultSet.getString("id"),
                    email = resultSet.getString("email"),
                    displayName = resultSet.getString("display_name"),
                    passwordHash = resultSet.getString("password_hash"),
                    role = resultSet.getString("role"),
                    status = resultSet.getString("status")
                )
            }
        }
    }

    override fun findUsers(
        filter: AdminUserFilter,
        pageRequest: PageRequest
    ): PageResponse<AdminUserDetailResponse> = dataSource.connection.use { conn ->
        val whereClauses = mutableListOf<String>()
        val params = mutableListOf<Any>()

        if (!filter.query.isNullOrBlank()) {
            whereClauses.add("(email ILIKE ? OR display_name ILIKE ?)")
            val q = "%${filter.query.trim()}%"
            params.add(q)
            params.add(q)
        }

        if (!filter.role.isNullOrBlank()) {
            whereClauses.add("role = ?")
            params.add(filter.role.trim().lowercase())
        }

        if (!filter.status.isNullOrBlank()) {
            whereClauses.add("status = ?")
            params.add(filter.status.trim().lowercase())
        }

        val whereSql = if (whereClauses.isEmpty()) "" else "WHERE " + whereClauses.joinToString(" AND ")

        val countSql = "SELECT COUNT(*) FROM admin.admin_users $whereSql"
        val totalItems = conn.prepareStatement(countSql).use { stmt ->
            params.forEachIndexed { index, param ->
                stmt.setObject(index + 1, param)
            }
            stmt.executeQuery().use { rs ->
                if (rs.next()) rs.getLong(1) else 0L
            }
        }

        val sortCol = ALLOWED_SORTS[pageRequest.sort] ?: "created_at"
        val sortDir = pageRequest.direction.sql

        val querySql = """
            SELECT id, email, display_name, role, status, auth_provider, last_login_at, created_at, created_by
            FROM admin.admin_users
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
                val list = mutableListOf<AdminUserDetailResponse>()
                while (rs.next()) {
                    list.add(mapUserDetail(rs))
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

    override fun createSession(userId: String, tokenHash: String, expiresAt: Instant) {
        dataSource.connection.use { connection ->
            connection.prepareStatement(
                """
                INSERT INTO admin.admin_sessions (admin_user_id, session_token_hash, expires_at)
                VALUES (?::uuid, ?, ?)
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, userId)
                statement.setString(2, tokenHash)
                statement.setTimestamp(3, Timestamp.from(expiresAt))
                statement.executeUpdate()
            }
            connection.prepareStatement(
                "UPDATE admin.admin_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = ?::uuid"
            ).use { statement ->
                statement.setString(1, userId)
                statement.executeUpdate()
            }
        }
    }

    override fun findUserBySessionTokenHash(tokenHash: String): AdminUserRecord? =
        dataSource.connection.use { connection ->
            connection.prepareStatement(
                """
                SELECT u.id, u.email, u.display_name, u.password_hash, u.role, u.status
                FROM admin.admin_sessions s
                JOIN admin.admin_users u ON u.id = s.admin_user_id
                WHERE s.session_token_hash = ?
                  AND s.revoked_at IS NULL
                  AND s.expires_at > NOW()
                  AND u.status = 'active'
                LIMIT 1
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, tokenHash)
                statement.executeQuery().use { resultSet ->
                    if (!resultSet.next()) return@use null
                    AdminUserRecord(
                        id = resultSet.getString("id"),
                        email = resultSet.getString("email"),
                        displayName = resultSet.getString("display_name"),
                        passwordHash = resultSet.getString("password_hash"),
                        role = resultSet.getString("role"),
                        status = resultSet.getString("status")
                    )
                }
            }
        }

    override fun revokeSession(tokenHash: String): String? = dataSource.connection.use { connection ->
        connection.prepareStatement(
            """
            UPDATE admin.admin_sessions
            SET revoked_at = COALESCE(revoked_at, NOW())
            WHERE session_token_hash = ?
            RETURNING admin_user_id
            """.trimIndent()
        ).use { statement ->
            statement.setString(1, tokenHash)
            statement.executeQuery().use { resultSet ->
                if (resultSet.next()) resultSet.getString("admin_user_id") else null
            }
        }
    }

    override fun revokeAllSessionsForUser(userId: String): Int = dataSource.connection.use { connection ->
        val userUuid = try {
            UUID.fromString(userId)
        } catch (_: Exception) {
            return@use 0
        }
        connection.prepareStatement(
            """
            UPDATE admin.admin_sessions
            SET revoked_at = COALESCE(revoked_at, NOW())
            WHERE admin_user_id = ? AND revoked_at IS NULL
            """.trimIndent()
        ).use { statement ->
            statement.setObject(1, userUuid)
            statement.executeUpdate()
        }
    }

    override fun inviteUser(
        email: String,
        displayName: String,
        role: String,
        createdBy: String?
    ): AdminUserDetailResponse = dataSource.connection.use { connection ->
        val normalizedEmail = email.trim().lowercase()
        val existing = findUserByEmail(normalizedEmail)
        if (existing != null) {
            throw ConflictException("이미 등록된 이메일 주소입니다: $normalizedEmail")
        }

        val creatorUuid = createdBy?.let {
            try { UUID.fromString(it) } catch (_: Exception) { null }
        }

        connection.prepareStatement(
            """
            INSERT INTO admin.admin_users (
                email, display_name, role, status, auth_provider, created_by
            ) VALUES (
                ?, ?, ?, 'invited', 'password', ?
            ) RETURNING id, email, display_name, role, status, auth_provider, last_login_at, created_at, created_by
            """.trimIndent()
        ).use { statement ->
            statement.setString(1, normalizedEmail)
            statement.setString(2, displayName.trim())
            statement.setString(3, role.trim().lowercase())
            if (creatorUuid == null) statement.setNull(4, Types.OTHER) else statement.setObject(4, creatorUuid)

            statement.executeQuery().use { rs ->
                if (rs.next()) {
                    mapUserDetail(rs)
                } else {
                    throw RuntimeException("관리자 사용자 생성에 실패했습니다.")
                }
            }
        }
    }

    override fun updateUserRole(userId: String, newRole: String) {
        dataSource.connection.use { connection ->
            val userUuid = try {
                UUID.fromString(userId)
            } catch (_: Exception) {
                throw ResourceNotFoundException(message = "사용자를 찾을 수 없습니다: $userId")
            }

            val count = connection.prepareStatement(
                """
                UPDATE admin.admin_users
                SET role = ?, updated_at = NOW()
                WHERE id = ?
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, newRole.trim().lowercase())
                statement.setObject(2, userUuid)
                statement.executeUpdate()
            }

            if (count == 0) {
                throw ResourceNotFoundException(message = "사용자를 찾을 수 없습니다: $userId")
            }
        }
    }

    override fun updateUserStatus(userId: String, newStatus: String) {
        dataSource.connection.use { connection ->
            val userUuid = try {
                UUID.fromString(userId)
            } catch (_: Exception) {
                throw ResourceNotFoundException(message = "사용자를 찾을 수 없습니다: $userId")
            }

            val count = connection.prepareStatement(
                """
                UPDATE admin.admin_users
                SET status = ?, updated_at = NOW()
                WHERE id = ?
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, newStatus.trim().lowercase())
                statement.setObject(2, userUuid)
                statement.executeUpdate()
            }

            if (count == 0) {
                throw ResourceNotFoundException(message = "사용자를 찾을 수 없습니다: $userId")
            }
        }
    }

    override fun recordAudit(
        userId: String?,
        action: String,
        result: String,
        requestId: String,
        ipAddress: String?,
        resourceType: String,
        resourceId: String?,
        beforeData: String?,
        afterData: String?,
        metadata: String?
    ) {
        dataSource.connection.use { connection ->
            connection.prepareStatement(
                """
                INSERT INTO admin.admin_audit_logs (
                    admin_user_id, action, resource_type, resource_id, result, request_id, ip_address,
                    before_data, after_data, metadata
                ) VALUES (
                    ?::uuid, ?, ?, ?, ?, ?, ?::inet,
                    ?::jsonb, ?::jsonb, COALESCE(?::jsonb, '{}'::jsonb)
                )
                """.trimIndent()
            ).use { statement ->
                if (userId == null) statement.setNull(1, Types.VARCHAR) else statement.setString(1, userId)
                statement.setString(2, action)
                statement.setString(3, resourceType)
                if (resourceId == null) statement.setNull(4, Types.VARCHAR) else statement.setString(4, resourceId)
                statement.setString(5, result)
                statement.setString(6, requestId)
                if (ipAddress == null) statement.setNull(7, Types.VARCHAR) else statement.setString(7, ipAddress)
                if (beforeData == null) statement.setNull(8, Types.VARCHAR) else statement.setString(8, beforeData)
                if (afterData == null) statement.setNull(9, Types.VARCHAR) else statement.setString(9, afterData)
                if (metadata == null) statement.setNull(10, Types.VARCHAR) else statement.setString(10, metadata)
                statement.executeUpdate()
            }
        }
    }

    override fun bootstrapOwner(email: String, displayName: String, passwordHash: String): Boolean {
        return dataSource.connection.use { connection ->
            connection.autoCommit = false
            try {
                val existingOwner = connection.prepareStatement(
                    "SELECT email FROM admin.admin_users WHERE role = 'owner' LIMIT 1 FOR UPDATE"
                ).use { statement ->
                    statement.executeQuery().use { resultSet ->
                        if (resultSet.next()) resultSet.getString("email") else null
                    }
                }
                if (existingOwner != null) {
                    connection.rollback()
                    return@use existingOwner.equals(email, ignoreCase = true)
                }

                connection.prepareStatement(
                    """
                    INSERT INTO admin.admin_users (
                        email, display_name, password_hash, auth_provider, role, status,
                        password_changed_at
                    ) VALUES (?, ?, ?, 'password', 'owner', 'active', NOW())
                    """.trimIndent()
                ).use { statement ->
                    statement.setString(1, email)
                    statement.setString(2, displayName)
                    statement.setString(3, passwordHash)
                    statement.executeUpdate()
                }
                connection.commit()
                true
            } catch (error: Throwable) {
                connection.rollback()
                throw error
            } finally {
                connection.autoCommit = true
            }
        }
    }

    private fun mapUserDetail(rs: ResultSet): AdminUserDetailResponse = AdminUserDetailResponse(
        id = rs.getString("id"),
        email = rs.getString("email"),
        displayName = rs.getString("display_name"),
        role = rs.getString("role"),
        status = rs.getString("status"),
        authProvider = rs.getString("auth_provider"),
        lastLoginAt = rs.getTimestamp("last_login_at")?.toInstant()?.toString(),
        createdAt = rs.getTimestamp("created_at").toInstant().toString(),
        createdBy = rs.getString("created_by")
    )
}
