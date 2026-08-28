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
import java.util.logging.Logger
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AdminAuthRouteTest {
    private val passwordHasher = PasswordHasher()
    private val ownerUser = AdminUserRecord(
        id = "11111111-1111-1111-1111-111111111111",
        email = "owner@michi.local",
        displayName = "Michi Owner",
        passwordHash = passwordHasher.hash("valid-password-123".toCharArray()),
        role = "owner",
        status = "active"
    )

    private val viewerUser = AdminUserRecord(
        id = "33333333-3333-3333-3333-333333333333",
        email = "viewer@michi.local",
        displayName = "Michi Viewer",
        passwordHash = passwordHasher.hash("viewer-password-123".toCharArray()),
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
    fun `login issues HttpOnly cookie and cookie authenticates me endpoint`() = testApplication {
        val store = FakeAuthStore(ownerUser)
        val authService = AuthService(store, passwordHasher, 12)
        application {
            module(config, unusableDataSource(), authServiceOverride = authService)
        }

        val login = client.post("/api/admin/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"owner@michi.local","password":"valid-password-123"}""")
        }

        assertEquals(HttpStatusCode.OK, login.status)
        val setCookie = login.headers[HttpHeaders.SetCookie].orEmpty()
        assertTrue(setCookie.contains("michi_admin_session="))
        assertTrue(setCookie.contains("HttpOnly", ignoreCase = true))
        assertTrue(setCookie.contains("SameSite=Strict", ignoreCase = true))

        val cookie = setCookie.substringBefore(';')
        val me = client.get("/api/admin/auth/me") {
            header(HttpHeaders.Cookie, cookie)
        }
        assertEquals(HttpStatusCode.OK, me.status)
        assertTrue(me.bodyAsText().contains("owner@michi.local"))
    }

    @Test
    fun `protected endpoint rejects missing session`() = testApplication {
        val authService = AuthService(FakeAuthStore(ownerUser), passwordHasher, 12)
        application {
            module(config, unusableDataSource(), authServiceOverride = authService)
        }

        assertEquals(HttpStatusCode.Unauthorized, client.get("/api/admin/summary").status)
    }

    @Test
    fun `owner can list users and invite new user`() = testApplication {
        val store = FakeAuthStore(ownerUser)
        val authService = AuthService(store, passwordHasher, 12)
        application {
            module(config, unusableDataSource(), authServiceOverride = authService)
        }

        val login = client.post("/api/admin/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"owner@michi.local","password":"valid-password-123"}""")
        }
        val cookie = login.headers[HttpHeaders.SetCookie]?.substringBefore(';') ?: ""

        val listResp = client.get("/api/admin/users") {
            header(HttpHeaders.Cookie, cookie)
        }
        assertEquals(HttpStatusCode.OK, listResp.status)
        assertTrue(listResp.bodyAsText().contains("owner@michi.local"))

        val inviteResp = client.post("/api/admin/users/invite") {
            header(HttpHeaders.Cookie, cookie)
            contentType(ContentType.Application.Json)
            setBody("""{"email":"newop@michi.local","displayName":"New OP","role":"operator"}""")
        }
        assertEquals(HttpStatusCode.Created, inviteResp.status)
        assertTrue(inviteResp.bodyAsText().contains("newop@michi.local"))
    }

    @Test
    fun `viewer is forbidden from user management and audit logs`() = testApplication {
        val store = FakeAuthStore(viewerUser)
        val authService = AuthService(store, passwordHasher, 12)
        application {
            module(config, unusableDataSource(), authServiceOverride = authService)
        }

        val login = client.post("/api/admin/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"viewer@michi.local","password":"viewer-password-123"}""")
        }
        val cookie = login.headers[HttpHeaders.SetCookie]?.substringBefore(';') ?: ""

        val userListResp = client.get("/api/admin/users") {
            header(HttpHeaders.Cookie, cookie)
        }
        assertEquals(HttpStatusCode.Forbidden, userListResp.status)

        val auditResp = client.get("/api/admin/audit-logs") {
            header(HttpHeaders.Cookie, cookie)
        }
        assertEquals(HttpStatusCode.Forbidden, auditResp.status)
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

    private class FakeAuthStore(private val user: AdminUserRecord) : AuthStore {
        private var tokenHash: String? = null
        private val users = mutableListOf(user)

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
            this.tokenHash = tokenHash
        }

        override fun findUserBySessionTokenHash(tokenHash: String): AdminUserRecord? =
            user.takeIf { tokenHash == this.tokenHash }

        override fun revokeSession(tokenHash: String): String? = user.id.takeIf { tokenHash == this.tokenHash }

        override fun revokeAllSessionsForUser(userId: String): Int {
            tokenHash = null
            return 1
        }

        override fun inviteUser(
            email: String,
            displayName: String,
            role: String,
            createdBy: String?
        ): AdminUserDetailResponse {
            val created = AdminUserRecord(
                id = java.util.UUID.randomUUID().toString(),
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
                users[idx] = users[idx].copy(role = newRole)
            }
        }

        override fun updateUserStatus(userId: String, newStatus: String) {
            val idx = users.indexOfFirst { it.id == userId }
            if (idx != -1) {
                users[idx] = users[idx].copy(status = newStatus)
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
