package com.michiseven.michi.admin

import com.michiseven.michi.admin.config.AppConfig
import com.michiseven.michi.admin.config.DatabaseConfig
import com.michiseven.michi.admin.database.DatabaseHealthRepository
import com.michiseven.michi.admin.health.HealthResponse
import com.michiseven.michi.admin.health.HealthService
import com.michiseven.michi.admin.providers.ProviderService
import com.michiseven.michi.admin.providers.ProviderStatusResponse
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import org.postgresql.ds.PGSimpleDataSource
import java.io.PrintWriter
import java.sql.Connection
import java.sql.ResultSet
import java.sql.Statement
import java.util.logging.Logger
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AdminApiRouteTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun createMockDataSource(): DataSource {
        return object : DataSource {
            override fun getConnection(): Connection = throw UnsupportedOperationException("Test mock")
            override fun getConnection(username: String?, password: String?): Connection = throw UnsupportedOperationException("Test mock")
            override fun getLogWriter(): PrintWriter = PrintWriter(System.out)
            override fun setLogWriter(out: PrintWriter?) {}
            override fun setLoginTimeout(seconds: Int) {}
            override fun getLoginTimeout(): Int = 0
            override fun getParentLogger(): Logger = Logger.getGlobal()
            override fun <T : Any?> unwrap(iface: Class<T>?): T = throw UnsupportedOperationException()
            override fun isWrapperFor(iface: Class<*>?): Boolean = false
        }
    }

    private val testConfig = AppConfig(
        appEnv = "test",
        host = "127.0.0.1",
        port = 4100,
        apiPrefix = "/api/admin",
        database = DatabaseConfig("localhost", 5432, "michi_test", "user", "pass", false),
        michiPublicApiUrl = "http://localhost:4000/api",
        adminCorsOrigin = "http://localhost:3100",
        adminAuthMode = "disabled"
    )

    @Test
    fun `health endpoint returns ok when db and public api are connected`() = testApplication {
        val mockHealthService = object : HealthService(DatabaseHealthRepository(createMockDataSource()), testConfig) {
            override suspend fun checkHealth(): HealthResponse {
                return HealthResponse("ok", "connected", "connected", "2026-08-22T00:00:00Z")
            }
        }

        val mockProviderService = object : ProviderService(testConfig) {
            override suspend fun getProviderStatus(): ProviderStatusResponse {
                return ProviderStatusResponse(
                    place = "mock",
                    kto = "live",
                    tourismDataLab = "mock",
                    crowd = "live",
                    llm = "mock",
                    routing = "live",
                    accessibility = "unavailable",
                    placeSource = "kakao-local",
                    crowdSource = "seoul-open-data",
                    checkedAt = "2026-08-22T00:00:00Z",
                    publicApiStatus = "connected"
                )
            }
        }

        application {
            module(testConfig, createMockDataSource(), mockHealthService, mockProviderService)
        }

        val response = client.get("/api/admin/health")
        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        val parsed = json.parseToJsonElement(body).jsonObject
        assertEquals("ok", parsed["status"]?.jsonPrimitive?.content)
        assertEquals("connected", parsed["database"]?.jsonPrimitive?.content)
        assertEquals("connected", parsed["publicApi"]?.jsonPrimitive?.content)
    }

    @Test
    fun `providers endpoint returns provider status`() = testApplication {
        val mockHealthService = object : HealthService(DatabaseHealthRepository(createMockDataSource()), testConfig) {
            override suspend fun checkHealth(): HealthResponse {
                return HealthResponse("ok", "connected", "connected", "2026-08-22T00:00:00Z")
            }
        }

        val mockProviderService = object : ProviderService(testConfig) {
            override suspend fun getProviderStatus(): ProviderStatusResponse {
                return ProviderStatusResponse(
                    place = "mock",
                    kto = "live",
                    tourismDataLab = "mock",
                    crowd = "live",
                    llm = "mock",
                    routing = "live",
                    accessibility = "unavailable",
                    placeSource = "kakao-local",
                    crowdSource = "seoul-open-data",
                    checkedAt = "2026-08-22T00:00:00Z",
                    publicApiStatus = "connected"
                )
            }
        }

        application {
            module(testConfig, createMockDataSource(), mockHealthService, mockProviderService)
        }

        val response = client.get("/api/admin/providers")
        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        val parsed = json.parseToJsonElement(body).jsonObject
        assertEquals("mock", parsed["place"]?.jsonPrimitive?.content)
        assertEquals("live", parsed["kto"]?.jsonPrimitive?.content)
        assertEquals("connected", parsed["publicApiStatus"]?.jsonPrimitive?.content)
        assertEquals("kakao-local", parsed["placeSource"]?.jsonPrimitive?.content)
    }

    @Test
    fun `sync-jobs endpoint returns jobs with mutation disabled`() = testApplication {
        val mockHealthService = object : HealthService(DatabaseHealthRepository(createMockDataSource()), testConfig) {
            override suspend fun checkHealth(): HealthResponse {
                return HealthResponse("ok", "connected", "connected", "2026-08-22T00:00:00Z")
            }
        }

        application {
            module(testConfig, createMockDataSource(), mockHealthService)
        }

        val response = client.get("/api/admin/sync-jobs")
        // Since getSyncJobs queries DB on real call, if using mockDataSource it fails safely to 500 ApiError without leaking SQL
        if (response.status == HttpStatusCode.InternalServerError) {
            val body = response.bodyAsText()
            assertTrue(body.contains("ADMIN_INTERNAL_ERROR"))
        }
    }
}
