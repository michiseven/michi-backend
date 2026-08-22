package com.michiseven.michi.admin.health

import com.michiseven.michi.admin.config.AppConfig
import com.michiseven.michi.admin.database.DatabaseHealthRepository
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.time.Instant

@Serializable
data class HealthResponse(
    val status: String,
    val database: String,
    val publicApi: String,
    val timestamp: String
)

open class HealthService(
    private val dbHealthRepo: DatabaseHealthRepository,
    private val config: AppConfig,
    private val httpClient: HttpClient = HttpClient(CIO) {
        engine {
            requestTimeout = 3000
        }
    }
) {
    private val logger = LoggerFactory.getLogger(HealthService::class.java)
    private val json = Json { ignoreUnknownKeys = true }

    open suspend fun checkHealth(): HealthResponse {
        val dbOk = dbHealthRepo.isDatabaseConnected()
        val publicApiOk = checkPublicApiHealth()

        val overallStatus = if (dbOk && publicApiOk) "ok" else "degraded"
        val dbStatus = if (dbOk) "connected" else "unavailable"
        val publicApiStatus = if (publicApiOk) "connected" else "unavailable"

        return HealthResponse(
            status = overallStatus,
            database = dbStatus,
            publicApi = publicApiStatus,
            timestamp = Instant.now().toString()
        )
    }

    open suspend fun checkPublicApiHealth(): Boolean {
        return try {
            val response = httpClient.get("${config.michiPublicApiUrl}/health") {
                header("Accept", "application/json")
            }
            if (response.status.isSuccess()) {
                val body = response.bodyAsText()
                val parsed = json.parseToJsonElement(body).jsonObject
                parsed["status"]?.jsonPrimitive?.content == "ok"
            } else {
                false
            }
        } catch (e: Exception) {
            logger.warn("Public API health check failed: {}", e.message)
            false
        }
    }
}
