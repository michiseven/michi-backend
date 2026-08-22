package com.michiseven.michi.admin

import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.SortDirection
import com.michiseven.michi.admin.config.AppConfig
import com.michiseven.michi.admin.config.DatabaseConfig
import com.michiseven.michi.admin.config.EnvironmentValidator
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AppConfigTest {

    @Test
    fun `production environment rejects auth disabled`() {
        val config = AppConfig(
            appEnv = "production",
            host = "127.0.0.1",
            port = 4100,
            apiPrefix = "/api/admin",
            database = DatabaseConfig("localhost", 5432, "michi", "user", "pass", false),
            michiPublicApiUrl = "http://localhost:4000/api",
            adminCorsOrigin = "http://localhost:3100",
            adminAuthMode = "disabled"
        )

        val exception = assertThrows<IllegalStateException> {
            EnvironmentValidator.validate(config)
        }
        assertTrue(exception.message!!.contains("CRITICAL_SECURITY_ERROR"))
    }

    @Test
    fun `development environment allows auth disabled`() {
        val config = AppConfig(
            appEnv = "development",
            host = "127.0.0.1",
            port = 4100,
            apiPrefix = "/api/admin",
            database = DatabaseConfig("localhost", 5432, "michi", "user", "pass", false),
            michiPublicApiUrl = "http://localhost:4000/api",
            adminCorsOrigin = "http://localhost:3100",
            adminAuthMode = "disabled"
        )

        EnvironmentValidator.validate(config)
        assertFalse(config.isProduction)
    }

    @Test
    fun `page request sanitizes boundaries and sorts`() {
        val allowed = setOf("name", "updatedAt")
        val req1 = PageRequest.of(0, 500, "name", "asc", allowed)
        assertEquals(1, req1.page)
        assertEquals(100, req1.pageSize)
        assertEquals("name", req1.sort)
        assertEquals(SortDirection.ASC, req1.direction)

        val req2 = PageRequest.of(-5, -10, "injected_col", "desc", allowed, "updatedAt")
        assertEquals(1, req2.page)
        assertEquals(1, req2.pageSize)
        assertEquals("updatedAt", req2.sort)
        assertEquals(SortDirection.DESC, req2.direction)
    }
}
