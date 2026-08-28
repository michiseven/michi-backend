package com.michiseven.michi.admin.auth

import com.michiseven.michi.admin.common.ForbiddenException
import com.michiseven.michi.admin.common.InvalidQueryException
import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import com.michiseven.michi.admin.common.ResourceNotFoundException
import com.michiseven.michi.admin.common.TooManyRequestsException
import com.michiseven.michi.admin.common.UnauthorizedException
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.util.Base64

class AuthService(
    private val repository: AuthStore,
    private val passwordHasher: PasswordHasher,
    private val sessionTtlHours: Long,
    private val rateLimiter: LoginRateLimiter = LoginRateLimiter(),
    private val clock: Clock = Clock.systemUTC(),
    private val secureRandom: SecureRandom = SecureRandom()
) {
    fun login(
        email: String,
        password: String,
        requestId: String,
        clientKey: String,
        ipAddress: String?
    ): CreatedAdminSession {
        val normalizedEmail = email.trim().lowercase()
        if (normalizedEmail.isBlank() || password.isBlank()) {
            throw UnauthorizedException("이메일과 비밀번호를 확인해 주세요.", "ADMIN_INVALID_CREDENTIALS")
        }

        val rateLimitKey = "$clientKey:$normalizedEmail"
        if (rateLimiter.isBlocked(rateLimitKey)) {
            throw TooManyRequestsException()
        }

        val user = repository.findUserByEmail(normalizedEmail)
        val passwordValid = user?.passwordHash?.let { hash ->
            passwordHasher.verify(hash, password.toCharArray())
        } ?: false

        if (user == null || !passwordValid || user.status != "active") {
            rateLimiter.recordFailure(rateLimitKey)
            repository.recordAudit(
                userId = user?.id,
                action = "admin.login",
                result = "failure",
                requestId = requestId,
                ipAddress = ipAddress
            )
            throw UnauthorizedException("이메일 또는 비밀번호가 올바르지 않습니다.", "ADMIN_INVALID_CREDENTIALS")
        }

        rateLimiter.reset(rateLimitKey)
        val rawToken = generateToken()
        val expiresAt = clock.instant().plus(Duration.ofHours(sessionTtlHours))
        repository.createSession(user.id, hashToken(rawToken), expiresAt)
        repository.recordAudit(
            userId = user.id,
            action = "admin.login",
            result = "success",
            requestId = requestId,
            ipAddress = ipAddress
        )

        return CreatedAdminSession(
            user = user.toResponse(),
            rawToken = rawToken,
            expiresAt = expiresAt.toString()
        )
    }

    fun authenticate(rawToken: String?): AdminUserRecord {
        if (rawToken.isNullOrBlank()) throw UnauthorizedException()
        return repository.findUserBySessionTokenHash(hashToken(rawToken))
            ?: throw UnauthorizedException("세션이 만료되었거나 유효하지 않습니다.")
    }

    fun logout(rawToken: String?, requestId: String, ipAddress: String?) {
        if (rawToken.isNullOrBlank()) return
        val userId = repository.revokeSession(hashToken(rawToken))
        if (userId != null) {
            repository.recordAudit(
                userId = userId,
                action = "admin.logout",
                result = "success",
                requestId = requestId,
                ipAddress = ipAddress
            )
        }
    }

    fun listUsers(
        actor: AdminUserRecord,
        filter: AdminUserFilter,
        pageRequest: PageRequest
    ): PageResponse<AdminUserDetailResponse> {
        RbacPolicy.checkPermission(actor, AdminPermission.READ_USERS)
        return repository.findUsers(filter, pageRequest)
    }

    fun inviteUser(
        actor: AdminUserRecord,
        req: InviteAdminUserRequest,
        requestId: String,
        ipAddress: String?
    ): AdminUserDetailResponse {
        RbacPolicy.checkPermission(actor, AdminPermission.INVITE_USERS)

        val normalizedEmail = req.email.trim().lowercase()
        if (normalizedEmail.isBlank() || !normalizedEmail.contains("@")) {
            throw InvalidQueryException("유효한 이메일 주소를 입력해 주세요.")
        }
        if (req.displayName.trim().isBlank()) {
            throw InvalidQueryException("사용자 이름을 입력해 주세요.")
        }

        val targetRole = AdminRole.fromKey(req.role)
            ?: throw InvalidQueryException("유효하지 않은 역할입니다: ${req.role}")

        if (targetRole == AdminRole.OWNER && !RbacPolicy.hasPermission(actor.role, AdminPermission.MANAGE_OWNERS)) {
            throw ForbiddenException("최고 관리자(owner) 역할은 최고 관리자만 부여할 수 있습니다.")
        }

        val created = repository.inviteUser(
            email = normalizedEmail,
            displayName = req.displayName.trim(),
            role = targetRole.key,
            createdBy = actor.id
        )

        repository.recordAudit(
            userId = actor.id,
            action = "admin.user.invite",
            result = "success",
            requestId = requestId,
            ipAddress = ipAddress,
            resourceType = "admin_user",
            resourceId = created.id,
            afterData = """{"email":"${created.email}","role":"${created.role}"}"""
        )

        return created
    }

    fun updateUserRole(
        actor: AdminUserRecord,
        targetUserId: String,
        newRoleStr: String,
        requestId: String,
        ipAddress: String?
    ): AdminUserDetailResponse {
        RbacPolicy.checkPermission(actor, AdminPermission.MANAGE_USERS)

        val targetUser = repository.findUserById(targetUserId)
            ?: throw ResourceNotFoundException(message = "사용자를 찾을 수 없습니다: $targetUserId")

        val newRole = AdminRole.fromKey(newRoleStr)
            ?: throw InvalidQueryException("유효하지 않은 역할입니다: $newRoleStr")

        val targetCurrentRole = AdminRole.fromKey(targetUser.role)

        if ((targetCurrentRole == AdminRole.OWNER || newRole == AdminRole.OWNER) &&
            !RbacPolicy.hasPermission(actor.role, AdminPermission.MANAGE_OWNERS)
        ) {
            throw ForbiddenException("최고 관리자(owner)의 역할을 변경하거나 최고 관리자로 승격하는 작업은 최고 관리자만 수행할 수 있습니다.")
        }

        repository.updateUserRole(targetUserId, newRole.key)

        repository.recordAudit(
            userId = actor.id,
            action = "admin.user.update_role",
            result = "success",
            requestId = requestId,
            ipAddress = ipAddress,
            resourceType = "admin_user",
            resourceId = targetUserId,
            beforeData = """{"role":"${targetUser.role}"}""",
            afterData = """{"role":"${newRole.key}"}"""
        )

        val updated = repository.findUserById(targetUserId)!!
        return AdminUserDetailResponse(
            id = updated.id,
            email = updated.email,
            displayName = updated.displayName,
            role = updated.role,
            status = updated.status,
            authProvider = "password",
            lastLoginAt = null,
            createdAt = "",
            createdBy = null
        )
    }

    fun updateUserStatus(
        actor: AdminUserRecord,
        targetUserId: String,
        newStatusStr: String,
        requestId: String,
        ipAddress: String?
    ): AdminUserDetailResponse {
        RbacPolicy.checkPermission(actor, AdminPermission.MANAGE_USERS)

        if (actor.id == targetUserId) {
            throw ForbiddenException("자기 자신의 계정 상태는 변경할 수 없습니다.")
        }

        val targetUser = repository.findUserById(targetUserId)
            ?: throw ResourceNotFoundException(message = "사용자를 찾을 수 없습니다: $targetUserId")

        val validStatuses = setOf("active", "suspended", "disabled")
        val normalizedStatus = newStatusStr.trim().lowercase()
        if (!validStatuses.contains(normalizedStatus)) {
            throw InvalidQueryException("유효하지 않은 상태입니다: $newStatusStr")
        }

        val targetRole = AdminRole.fromKey(targetUser.role)
        if (targetRole == AdminRole.OWNER && !RbacPolicy.hasPermission(actor.role, AdminPermission.MANAGE_OWNERS)) {
            throw ForbiddenException("최고 관리자(owner)의 상태는 최고 관리자만 변경할 수 있습니다.")
        }

        repository.updateUserStatus(targetUserId, normalizedStatus)

        if (normalizedStatus == "suspended" || normalizedStatus == "disabled") {
            repository.revokeAllSessionsForUser(targetUserId)
        }

        repository.recordAudit(
            userId = actor.id,
            action = "admin.user.update_status",
            result = "success",
            requestId = requestId,
            ipAddress = ipAddress,
            resourceType = "admin_user",
            resourceId = targetUserId,
            beforeData = """{"status":"${targetUser.status}"}""",
            afterData = """{"status":"$normalizedStatus"}"""
        )

        val updated = repository.findUserById(targetUserId)!!
        return AdminUserDetailResponse(
            id = updated.id,
            email = updated.email,
            displayName = updated.displayName,
            role = updated.role,
            status = updated.status,
            authProvider = "password",
            lastLoginAt = null,
            createdAt = "",
            createdBy = null
        )
    }

    private fun generateToken(): String {
        val bytes = ByteArray(32)
        secureRandom.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    internal fun hashToken(rawToken: String): String = MessageDigest.getInstance("SHA-256")
        .digest(rawToken.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
