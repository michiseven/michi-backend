package com.michiseven.michi.admin

import com.michiseven.michi.admin.audit.AdminAuditLogResponse
import com.michiseven.michi.admin.audit.AuditLogFilter
import com.michiseven.michi.admin.audit.AuditLogRepository
import com.michiseven.michi.admin.auth.AdminUserDetailResponse
import com.michiseven.michi.admin.auth.AdminUserFilter
import com.michiseven.michi.admin.auth.AdminUserRecord
import com.michiseven.michi.admin.auth.AuthService
import com.michiseven.michi.admin.auth.AuthStore
import com.michiseven.michi.admin.auth.PasswordHasher
import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import com.michiseven.michi.admin.config.AppConfig
import com.michiseven.michi.admin.config.DatabaseConfig
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import org.junit.jupiter.api.Test
import java.io.PrintWriter
import java.sql.Connection
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AdminUserAndAuditRouteTest {
    private val passwordHasher = PasswordHasher()

    private val owner = AdminUserRecord(
        id = "11111111-1111-1111-1111-111111111111",
        email = "owner@michi.local",
        displayName = "Michi Owner",
        passwordHash = passwordHasher.hash("owner-pass".toCharArray()),
        role = "owner",
        status = "active"
    )

    private val admin = AdminUserRecord(
        id = "22222222-2222-2222-2222-222222222222",
        email = "admin@michi.local",
        displayName = "Michi Admin",
        passwordHash = passwordHasher.hash("admin-pass".toCharArray()),
        role = "admin",
        status = "active"
    )

    private val operator = AdminUserRecord(
        id = "33333333-3333-3333-3333-333333333333",
        email = "operator@michi.local",
        displayName = "Michi Operator",
        passwordHash = passwordHasher.hash("op-pass".toCharArray()),
        role = "operator",
        status = "active"
    )

    private val viewer = AdminUserRecord(
        id = "44444444-4444-4444-4444-444444444444",
        email = "viewer@michi.local",
        displayName = "Michi Viewer",
        passwordHash = passwordHasher.hash("viewer-pass".toCharArray()),
        role = "viewer",
        status = "active"
    )

    private val config = AppConfig(
        appEnv = "test",
        host = "127.0.0.1",
        port = 4100,
        apiPrefix = "/api/admin",
        database = DatabaseConfig("localhost", 5432, "michi_test", "reader", "test", false),
        michiPublicApiUrl = "http://localhost:4000/api",
        adminCorsOrigin = "http://localhost:3100",
        adminAuthMode = "session"
    )

    @Test
    fun `user management lifecycle and RBAC enforcement`() = testApplication {
        val users = mutableListOf(owner, admin, operator, viewer)
        val store = InMemoryAuthStore(users)
        val authService = AuthService(store, passwordHasher, 12)

        application {
            module(config, unusableDataSource(), authServiceOverride = authService)
        }

        // 1. Login as Admin
        val adminLogin = client.post("/api/admin/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"admin@michi.local","password":"admin-pass"}""")
        }
        val adminCookie = adminLogin.headers[HttpHeaders.SetCookie]?.substringBefore(';') ?: ""

        // 2. Admin invites an operator -> 201 Created
        val inviteOp = client.post("/api/admin/users/invite") {
            header(HttpHeaders.Cookie, adminCookie)
            contentType(ContentType.Application.Json)
            setBody("""{"email":"new-op@michi.local","displayName":"New OP","role":"operator"}""")
        }
        assertEquals(HttpStatusCode.Created, inviteOp.status)
        assertTrue(inviteOp.bodyAsText().contains("new-op@michi.local"))

        // 3. Admin attempts to invite an owner -> 403 Forbidden
        val inviteOwner = client.post("/api/admin/users/invite") {
            header(HttpHeaders.Cookie, adminCookie)
            contentType(ContentType.Application.Json)
            setBody("""{"email":"evil-owner@michi.local","displayName":"Fake Owner","role":"owner"}""")
        }
        assertEquals(HttpStatusCode.Forbidden, inviteOwner.status)

        // 4. Login as Owner
        val ownerLogin = client.post("/api/admin/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"owner@michi.local","password":"owner-pass"}""")
        }
        val ownerCookie = ownerLogin.headers[HttpHeaders.SetCookie]?.substringBefore(';') ?: ""

        // 5. Owner updates operator to admin
        val updateRole = client.patch("/api/admin/users/${operator.id}/role") {
            header(HttpHeaders.Cookie, ownerCookie)
            contentType(ContentType.Application.Json)
            setBody("""{"role":"admin"}""")
        }
        assertEquals(HttpStatusCode.OK, updateRole.status)
        assertEquals("admin", users.find { it.id == operator.id }?.role)

        // 6. Owner suspends viewer
        val updateStatus = client.patch("/api/admin/users/${viewer.id}/status") {
            header(HttpHeaders.Cookie, ownerCookie)
            contentType(ContentType.Application.Json)
            setBody("""{"status":"suspended"}""")
        }
        assertEquals(HttpStatusCode.OK, updateStatus.status)
        assertEquals("suspended", users.find { it.id == viewer.id }?.status)

        // 7. Owner cannot suspend self -> 403 Forbidden
        val selfSuspend = client.patch("/api/admin/users/${owner.id}/status") {
            header(HttpHeaders.Cookie, ownerCookie)
            contentType(ContentType.Application.Json)
            setBody("""{"status":"suspended"}""")
        }
        assertEquals(HttpStatusCode.Forbidden, selfSuspend.status)
    }

    private fun unusableDataSource(): DataSource = object : DataSource {
        override fun getConnection(): Connection = error("Core datasource must not be used in auth route tests")
        override fun getConnection(username: String?, password: String?): Connection = getConnection()
        override fun getLogWriter(): PrintWriter = PrintWriter(System.out)
        override fun setLogWriter(out: PrintWriter?) = Unit
        override fun setLoginTimeout(seconds: Int) = Unit
        override fun getLoginTimeout(): Int = 0
        override fun getParentLogger(): Logger = Logger.getGlobal()
        override fun <T : Any?> unwrap(iface: Class<T>?): T = error("Not a wrapper")
        override fun isWrapperFor(iface: Class<*>?): Boolean = false
    }

    private class InMemoryAuthStore(private val users: MutableList<AdminUserRecord>) : AuthStore {
        private val sessions = mutableMapOf<String, AdminUserRecord>()

        override fun findUserByEmail(email: String): AdminUserRecord? =
            users.find { it.email.equals(email, ignoreCase = true) }

        override fun findUserById(id: String): AdminUserRecord? =
            users.find { it.id == id }

        override fun findUsers(
            filter: AdminUserFilter,
            pageRequest: PageRequest
        ): PageResponse<AdminUserDetailResponse> {
            val filtered = users.filter { u ->
                (filter.role == null || u.role.equals(filter.role, ignoreCase = true)) &&
                (filter.status == null || u.status.equals(filter.status, ignoreCase = true))
            }.map {
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
            return PageResponse(filtered, 1, 20, filtered.size.toLong(), 1)
        }

        override fun createSession(userId: String, tokenHash: String, expiresAt: Instant) {
            val user = users.find { it.id == userId }
            if (user != null) {
                sessions[tokenHash] = user
            }
        }

        override fun findUserBySessionTokenHash(tokenHash: String): AdminUserRecord? {
            return sessions[tokenHash]
        }

        override fun revokeSession(tokenHash: String): String? {
            return sessions.remove(tokenHash)?.id
        }

        override fun revokeAllSessionsForUser(userId: String): Int {
            val toRemove = sessions.filter { it.value.id == userId }.keys
            toRemove.forEach { sessions.remove(it) }
            return toRemove.size
        }

        override fun inviteUser(
            email: String,
            displayName: String,
            role: String,
            createdBy: String?
        ): AdminUserDetailResponse {
            val created = AdminUserRecord(
                id = UUID.randomUUID().toString(),
                email = email,
                displayName = displayName,
                passwordHash = null,
                role = role,
                status = "invited"
            )
            users.add(created)
            return AdminUserDetailResponse(
                id = created.id,
                email = created.email,
                displayName = created.displayName,
                role = created.role,
                status = created.status,
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
        ) = Unit

        override fun bootstrapOwner(email: String, displayName: String, passwordHash: String): Boolean = true
    }
}
