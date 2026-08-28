package com.michiseven.michi.admin.providers

import com.michiseven.michi.admin.config.AppConfig
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
data class ProviderStatusResponse(
    val place: String,          // live | mock | unavailable
    val kto: String,            // live | mock | unavailable
    val tourismDataLab: String, // live | mock | unavailable
    val crowd: String,          // live | mock | unavailable
    val llm: String,            // live | mock | unavailable
    val routing: String,        // live | mock | unavailable
    val accessibility: String,  // live | unavailable
    val placeSource: String?,
    val crowdSource: String?,
    val checkedAt: String,
    val publicApiStatus: String // connected | unavailable
)

open class ProviderService(
    private val config: AppConfig,
    private val httpClient: HttpClient = HttpClient(CIO) {
        engine {
            requestTimeout = 3000
        }
    }
) {
    private val logger = LoggerFactory.getLogger(ProviderService::class.java)
    private val json = Json { ignoreUnknownKeys = true }

    open suspend fun getProviderStatus(): ProviderStatusResponse {
        val now = Instant.now().toString()
        return try {
            val response = httpClient.get("${config.michiPublicApiUrl}/health") {
                header("Accept", "application/json")
            }

            if (response.status.isSuccess()) {
                val body = response.bodyAsText()
                val parsed = json.parseToJsonElement(body).jsonObject
                val providerModes = parsed["providerModes"]?.jsonObject
                val providerSources = parsed["providerSources"]?.jsonObject

                fun extractMode(key: String): String {
                    val raw = providerModes?.get(key)?.jsonPrimitive?.content
                    return if (raw == "live" || raw == "mock") raw else "unavailable"
                }

                ProviderStatusResponse(
                    place = extractMode("place"),
                    kto = extractMode("kto"),
                    tourismDataLab = extractMode("tourismDataLab"),
                    crowd = extractMode("crowd"),
                    llm = extractMode("llm"),
                    routing = extractMode("routing"),
                    accessibility = providerModes?.get("accessibility")?.jsonPrimitive?.content
                        ?.takeIf { it == "live" || it == "unavailable" } ?: "unavailable",
                    placeSource = providerSources?.get("place")?.jsonPrimitive?.content,
                    crowdSource = providerSources?.get("crowd")?.jsonPrimitive?.content,
                    checkedAt = now,
                    publicApiStatus = "connected"
                )
            } else {
                fallbackUnavailable(now)
            }
        } catch (e: Exception) {
            logger.warn("Failed to fetch provider status from public API: {}", e.message)
            fallbackUnavailable(now)
        }
    }

    private fun fallbackUnavailable(checkedAt: String): ProviderStatusResponse {
        return ProviderStatusResponse(
            place = "unavailable",
            kto = "unavailable",
            tourismDataLab = "unavailable",
            crowd = "unavailable",
            llm = "unavailable",
            routing = "unavailable",
            accessibility = "unavailable",
            placeSource = null,
            crowdSource = null,
            checkedAt = checkedAt,
            publicApiStatus = "unavailable"
        )
    }
}
