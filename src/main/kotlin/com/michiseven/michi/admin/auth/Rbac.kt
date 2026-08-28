package com.michiseven.michi.admin.auth

import com.michiseven.michi.admin.common.ForbiddenException
import com.michiseven.michi.admin.common.UnauthorizedException
import io.ktor.server.application.ApplicationCall
import io.ktor.util.AttributeKey

enum class AdminRole(val key: String) {
    OWNER("owner"),
    ADMIN("admin"),
    OPERATOR("operator"),
    VIEWER("viewer");

    companion object {
        fun fromKey(key: String): AdminRole? = entries.find { it.key.equals(key, ignoreCase = true) }
    }
}

enum class AdminPermission {
    READ_DATA,
    READ_USERS,
    INVITE_USERS,
    MANAGE_USERS,
    MANAGE_OWNERS,
    READ_AUDIT_LOGS,
    TRIGGER_SYNC
}

object RbacPolicy {
    private val rolePermissions = mapOf(
        AdminRole.OWNER to setOf(
            AdminPermission.READ_DATA,
            AdminPermission.READ_USERS,
            AdminPermission.INVITE_USERS,
            AdminPermission.MANAGE_USERS,
            AdminPermission.MANAGE_OWNERS,
            AdminPermission.READ_AUDIT_LOGS,
            AdminPermission.TRIGGER_SYNC
        ),
        AdminRole.ADMIN to setOf(
            AdminPermission.READ_DATA,
            AdminPermission.READ_USERS,
            AdminPermission.INVITE_USERS,
            AdminPermission.MANAGE_USERS,
            AdminPermission.READ_AUDIT_LOGS,
            AdminPermission.TRIGGER_SYNC
        ),
        AdminRole.OPERATOR to setOf(
            AdminPermission.READ_DATA,
            AdminPermission.TRIGGER_SYNC
        ),
        AdminRole.VIEWER to setOf(
            AdminPermission.READ_DATA
        )
    )

    fun hasPermission(roleStr: String, permission: AdminPermission): Boolean {
        val role = AdminRole.fromKey(roleStr) ?: return false
        return rolePermissions[role]?.contains(permission) ?: false
    }

    fun hasAnyRole(roleStr: String, vararg allowedRoles: AdminRole): Boolean {
        val role = AdminRole.fromKey(roleStr) ?: return false
        return allowedRoles.contains(role)
    }

    fun checkRole(
        user: AdminUserRecord?,
        vararg allowedRoles: AdminRole
    ): AdminUserRecord {
        if (user == null || user.status != "active") {
            throw UnauthorizedException("관리자 로그인이 필요합니다.")
        }
        val userRole = AdminRole.fromKey(user.role)
        if (userRole == null || !allowedRoles.contains(userRole)) {
            throw ForbiddenException("해당 작업을 수행할 권한이 없습니다. (필요 권한: ${allowedRoles.joinToString(", ") { it.key }})")
        }
        return user
    }

    fun checkPermission(
        user: AdminUserRecord?,
        permission: AdminPermission
    ): AdminUserRecord {
        if (user == null || user.status != "active") {
            throw UnauthorizedException("관리자 로그인이 필요합니다.")
        }
        if (!hasPermission(user.role, permission)) {
            throw ForbiddenException("해당 작업을 수행할 권한이 없습니다. (필요 권한: $permission)")
        }
        return user
    }
}

val ADMIN_USER_KEY = AttributeKey<AdminUserRecord>("AdminUser")

var ApplicationCall.adminUser: AdminUserRecord?
    get() = attributes.getOrNull(ADMIN_USER_KEY)
    set(value) {
        if (value != null) {
            attributes.put(ADMIN_USER_KEY, value)
        } else {
            attributes.remove(ADMIN_USER_KEY)
        }
    }
