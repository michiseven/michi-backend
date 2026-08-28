package com.michiseven.michi.admin

import com.michiseven.michi.admin.auth.AdminRole
import com.michiseven.michi.admin.auth.AdminUserDetailResponse
import com.michiseven.michi.admin.auth.AdminUserFilter
import com.michiseven.michi.admin.auth.AdminUserRecord
import com.michiseven.michi.admin.auth.AuthService
import com.michiseven.michi.admin.auth.AuthStore
import com.michiseven.michi.admin.auth.InviteAdminUserRequest
import com.michiseven.michi.admin.auth.LoginRateLimiter
import com.michiseven.michi.admin.auth.PasswordHasher
import com.michiseven.michi.admin.common.ForbiddenException
import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import com.michiseven.michi.admin.common.TooManyRequestsException
import com.michiseven.michi.admin.common.UnauthorizedException
import org.junit.jupiter.api.Test
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class AuthServiceTest {
    private val passwordHasher = PasswordHasher()

    private val ownerUser = AdminUserRecord(
        id = "11111111-1111-1111-1111-111111111111",
        email = "owner@michi.local",
        displayName = "Michi Owner",
        passwordHash = passwordHasher.hash("correct-horse-battery".toCharArray()),
        role = "owner",
        status = "active"
    )

    private val adminUser = AdminUserRecord(
        id = "22222222-2222-2222-2222-222222222222",
        email = "admin@michi.local",
        displayName = "Michi Admin",
        passwordHash = passwordHasher.hash("admin-password".toCharArray()),
        role = "admin",
        status = "active"
    )

    private val viewerUser = AdminUserRecord(
        id = "33333333-3333-3333-3333-333333333333",
        email = "viewer@michi.local",
        displayName = "Michi Viewer",
        passwordHash = passwordHasher.hash("viewer-password".toCharArray()),
        role = "viewer",
        status = "active"
    )

    @Test
    fun `login creates opaque hashed session and authenticates it`() {
        val store = FakeAuthStore(mutableListOf(ownerUser))
        val service = AuthService(store, passwordHasher, 12)

        val session = service.login(
            "OWNER@michi.local",
            "correct-horse-battery",
            "request-1",
            "client-1",
            null
        )

        assertEquals("owner", session.user.role)
        assertTrue(session.rawToken.length >= 40)
        assertNotEquals(session.rawToken, store.sessionTokenHash)
        assertEquals(64, store.sessionTokenHash?.length)
        assertEquals("owner@michi.local", service.authenticate(session.rawToken).email)
        assertEquals(listOf("admin.login:success"), store.audits)
    }

    @Test
    fun `invalid password is rejected and audited`() {
        val store = FakeAuthStore(mutableListOf(ownerUser))
        val service = AuthService(store, passwordHasher, 12)

        assertFailsWith<UnauthorizedException> {
            service.login("owner@michi.local", "wrong-password", "request-2", "client-1", null)
        }
        assertEquals(listOf("admin.login:failure"), store.audits)
    }

    @Test
    fun `rate limiter blocks after repeated failures`() {
        val limiter = LoginRateLimiter(maximumAttempts = 2)
        limiter.recordFailure("client:owner")
        limiter.recordFailure("client:owner")
        assertTrue(limiter.isBlocked("client:owner"))

        val store = FakeAuthStore(mutableListOf())
        val service = AuthService(store, passwordHasher, 12, limiter)
        assertFailsWith<TooManyRequestsException> {
            service.login("owner", "wrong", "request-3", "client", null)
        }
    }

    @Test
    fun `admin can invite operator but cannot invite owner`() {
        val store = FakeAuthStore(mutableListOf(ownerUser, adminUser))
        val service = AuthService(store, passwordHasher, 12)

        val invited = service.inviteUser(
            actor = adminUser,
            req = InviteAdminUserRequest(
                email = "op@michi.local",
                displayName = "New Operator",
                role = "operator"
            ),
            requestId = "req-invite-1",
            ipAddress = "127.0.0.1"
        )
        assertEquals("operator", invited.role)
        assertEquals("op@michi.local", invited.email)

        assertFailsWith<ForbiddenException> {
            service.inviteUser(
                actor = adminUser,
                req = InviteAdminUserRequest(
                    email = "another-owner@michi.local",
                    displayName = "New Owner",
                    role = "owner"
                ),
                requestId = "req-invite-2",
                ipAddress = "127.0.0.1"
            )
        }
    }

    @Test
    fun `viewer cannot invite users`() {
        val store = FakeAuthStore(mutableListOf(viewerUser))
        val service = AuthService(store, passwordHasher, 12)

        assertFailsWith<ForbiddenException> {
            service.inviteUser(
                actor = viewerUser,
                req = InviteAdminUserRequest(
                    email = "test@michi.local",
                    displayName = "Test",
                    role = "viewer"
                ),
                requestId = "req-invite-3",
                ipAddress = null
            )
        }
    }

    @Test
    fun `admin cannot modify owner role`() {
        val store = FakeAuthStore(mutableListOf(ownerUser, adminUser))
        val service = AuthService(store, passwordHasher, 12)

        assertFailsWith<ForbiddenException> {
            service.updateUserRole(
                actor = adminUser,
                targetUserId = ownerUser.id,
                newRoleStr = "viewer",
                requestId = "req-role-1",
                ipAddress = null
            )
        }
    }

    @Test
    fun `owner can update user role and status and status suspension revokes sessions`() {
        val target = AdminUserRecord(
            id = "44444444-4444-4444-4444-444444444444",
            email = "target@michi.local",
            displayName = "Target",
            passwordHash = null,
            role = "viewer",
            status = "active"
        )
        val store = FakeAuthStore(mutableListOf(ownerUser, target))
        val service = AuthService(store, passwordHasher, 12)

        val updatedRole = service.updateUserRole(
            actor = ownerUser,
            targetUserId = target.id,
            newRoleStr = "operator",
            requestId = "req-role-2",
            ipAddress = null
        )
        assertEquals("operator", updatedRole.role)

        val updatedStatus = service.updateUserStatus(
            actor = ownerUser,
            targetUserId = target.id,
            newStatusStr = "suspended",
            requestId = "req-status-1",
            ipAddress = null
        )
        assertEquals("suspended", updatedStatus.status)
        assertEquals(1, store.revokedUserSessionCount)
    }

    @Test
    fun `user cannot suspend self`() {
        val store = FakeAuthStore(mutableListOf(ownerUser))
        val service = AuthService(store, passwordHasher, 12)

        assertFailsWith<ForbiddenException> {
            service.updateUserStatus(
                actor = ownerUser,
                targetUserId = ownerUser.id,
                newStatusStr = "suspended",
                requestId = "req-self-suspend",
                ipAddress = null
            )
        }
    }

    private class FakeAuthStore(private val users: MutableList<AdminUserRecord>) : AuthStore {
        var sessionTokenHash: String? = null
        private var expiresAt: Instant? = null
        val audits = mutableListOf<String>()
        var revokedUserSessionCount = 0

        override fun findUserByEmail(email: String): AdminUserRecord? =
            users.find { it.email.equals(email, ignoreCase = true) }

        override fun findUserById(id: String): AdminUserRecord? =
            users.find { it.id == id }

        override fun findUsers(
            filter: AdminUserFilter,
            pageRequest: PageRequest
        ): PageResponse<AdminUserDetailResponse> {
            val list = users.map {
                AdminUserDetailResponse(
                    id = it.id,
                    email = it.email,
                    displayName = it.displayName,
                    role = it.role,
                    status = it.status,
                    authProvider = "password",
                    lastLoginAt = null,
                    createdAt = Instant.now().toString(),
                    createdBy = null
                )
            }
            return PageResponse(list, 1, 20, list.size.toLong(), 1)
        }

        override fun createSession(userId: String, tokenHash: String, expiresAt: Instant) {
            sessionTokenHash = tokenHash
            this.expiresAt = expiresAt
        }

        override fun findUserBySessionTokenHash(tokenHash: String): AdminUserRecord? {
            return if (tokenHash == sessionTokenHash && expiresAt?.isAfter(Instant.now()) == true) {
                users.firstOrNull()
            } else null
        }

        override fun revokeSession(tokenHash: String): String? {
            if (tokenHash != sessionTokenHash) return null
            sessionTokenHash = null
            return users.firstOrNull()?.id
        }

        override fun revokeAllSessionsForUser(userId: String): Int {
            revokedUserSessionCount++
            sessionTokenHash = null
            return 1
        }

        override fun inviteUser(
            email: String,
            displayName: String,
            role: String,
            createdBy: String?
        ): AdminUserDetailResponse {
            val newUser = AdminUserRecord(
                id = java.util.UUID.randomUUID().toString(),
                email = email,
                displayName = displayName,
                passwordHash = null,
                role = role,
                status = "invited"
            )
            users.add(newUser)
            return AdminUserDetailResponse(
                id = newUser.id,
                email = newUser.email,
                displayName = newUser.displayName,
                role = newUser.role,
                status = newUser.status,
                authProvider = "password",
                lastLoginAt = null,
                createdAt = Instant.now().toString(),
                createdBy = createdBy
            )
        }

        override fun updateUserRole(userId: String, newRole: String) {
            val idx = users.indexOfFirst { it.id == userId }
            if (idx != -1) {
                val cur = users[idx]
                users[idx] = cur.copy(role = newRole)
            }
        }

        override fun updateUserStatus(userId: String, newStatus: String) {
            val idx = users.indexOfFirst { it.id == userId }
            if (idx != -1) {
                val cur = users[idx]
                users[idx] = cur.copy(status = newStatus)
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
            audits += "$action:$result"
        }

        override fun bootstrapOwner(email: String, displayName: String, passwordHash: String): Boolean = true
    }
}
