package com.michiseven.michi.admin.places

import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import com.michiseven.michi.admin.common.ResourceNotFoundException
import com.michiseven.michi.admin.database.withReadOnlyConnection
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.sql.ResultSet
import java.util.UUID
import javax.sql.DataSource

class PlaceRepository(private val dataSource: DataSource) {
    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        val ALLOWED_SORTS = mapOf(
            "updatedAt" to "p.updated_at",
            "name" to "p.name",
            "provider" to "p.source",
            "estimatedCost" to "p.estimated_cost_krw",
            "createdAt" to "p.created_at"
        )
    }

    fun findPlaces(filter: PlaceFilter, pageRequest: PageRequest): PageResponse<PlaceListItemDto> {
        return dataSource.withReadOnlyConnection { conn ->
            val whereClauses = mutableListOf<String>()
            val params = mutableListOf<Any>()

            if (!filter.query.isNullOrBlank()) {
                val q = "%${filter.query.trim()}%"
                whereClauses.add("(p.name ILIKE ? OR p.address ILIKE ? OR p.road_address ILIKE ? OR p.source_place_id ILIKE ?)")
                params.add(q)
                params.add(q)
                params.add(q)
                params.add(q)
            }

            val normalizedProvider = PlaceSources.normalizeFilter(filter.provider)
            if (normalizedProvider != null) {
                whereClauses.add("p.source = ?")
                params.add(normalizedProvider)
            }

            if (!filter.category.isNullOrBlank() && filter.category != "all") {
                whereClauses.add("p.category = ?")
                params.add(filter.category.trim())
            }

            when (filter.coordinateStatus?.lowercase()) {
                "present" -> whereClauses.add("p.location IS NOT NULL")
                "missing" -> whereClauses.add("p.location IS NULL")
            }

            when (filter.tourismMetricStatus?.lowercase()) {
                "linked" -> whereClauses.add("EXISTS (SELECT 1 FROM tourism_metrics tm WHERE tm.place_id = p.id)")
                "unlinked" -> whereClauses.add("NOT EXISTS (SELECT 1 FROM tourism_metrics tm WHERE tm.place_id = p.id)")
            }

            when (filter.priceEvidenceStatus?.lowercase()) {
                "verified" -> whereClauses.add("p.estimated_cost_krw IS NOT NULL AND p.price_evidence->>'verificationStatus' = 'verified' AND p.price_evidence->>'source' IN ('kakao-place-menu', 'kto-detail', 'manual')")
                "unverified" -> whereClauses.add("(p.estimated_cost_krw IS NOT NULL OR p.price_evidence IS NOT NULL) AND NOT (p.estimated_cost_krw IS NOT NULL AND p.price_evidence->>'verificationStatus' = 'verified' AND p.price_evidence->>'source' IN ('kakao-place-menu', 'kto-detail', 'manual'))")
                "missing" -> whereClauses.add("p.estimated_cost_krw IS NULL AND p.price_evidence IS NULL")
            }

            val whereSql = if (whereClauses.isNotEmpty()) "WHERE " + whereClauses.joinToString(" AND ") else ""

            val countSql = "SELECT COUNT(*) FROM places p $whereSql"
            var totalItems = 0L
            conn.prepareStatement(countSql).use { stmt ->
                params.forEachIndexed { index, param -> stmt.setObject(index + 1, param) }
                stmt.executeQuery().use { rs ->
                    if (rs.next()) totalItems = rs.getLong(1)
                }
            }

            val sortColumn = ALLOWED_SORTS[pageRequest.sort] ?: "p.updated_at"
            val directionSql = pageRequest.direction.sql

            val listSql = """
                SELECT 
                    p.id,
                    p.name,
                    p.source,
                    p.source_place_id,
                    p.category,
                    p.address,
                    p.road_address,
                    p.estimated_cost_krw,
                    p.price_evidence->>'source' as price_evidence_source,
                    p.price_evidence->>'verificationStatus' as price_evidence_verification_status,
                    ST_Y(p.location::geometry) as latitude,
                    ST_X(p.location::geometry) as longitude,
                    p.created_at,
                    p.updated_at,
                    COALESCE(tm_stat.metric_count, 0) as metric_count,
                    tm_stat.latest_period
                FROM places p
                LEFT JOIN LATERAL (
                    SELECT 
                        COUNT(*) as metric_count,
                        MAX(period_end)::text as latest_period
                    FROM tourism_metrics tm
                    WHERE tm.place_id = p.id
                ) tm_stat ON true
                $whereSql
                ORDER BY $sortColumn $directionSql, p.id DESC
                LIMIT ? OFFSET ?
            """.trimIndent()

            val items = mutableListOf<PlaceListItemDto>()
            conn.prepareStatement(listSql).use { stmt ->
                var paramIdx = 1
                params.forEach { param ->
                    stmt.setObject(paramIdx++, param)
                }
                stmt.setInt(paramIdx++, pageRequest.pageSize)
                stmt.setLong(paramIdx, pageRequest.offset)

                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        items.add(mapPlaceListItem(rs))
                    }
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
    }

    fun findPlaceById(id: String): PlaceDetailDto {
        val placeUuid = try {
            UUID.fromString(id)
        } catch (_: Exception) {
            throw ResourceNotFoundException(
                code = "ADMIN_PLACE_NOT_FOUND",
                message = "장소를 찾을 수 없습니다: $id"
            )
        }

        return dataSource.withReadOnlyConnection { conn ->
            val placeSql = """
                SELECT 
                    p.id,
                    p.name,
                    p.source,
                    p.source_place_id,
                    p.category,
                    p.raw_category,
                    p.district,
                    p.address,
                    p.road_address,
                    ST_Y(p.location::geometry) as latitude,
                    ST_X(p.location::geometry) as longitude,
                    p.raw_payload,
                    p.estimated_cost_krw,
                    p.price_evidence,
                    p.created_at,
                    p.updated_at
                FROM places p
                WHERE p.id = ?
            """.trimIndent()

            var detail: PlaceDetailDto? = null
            conn.prepareStatement(placeSql).use { stmt ->
                stmt.setObject(1, placeUuid)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        val latObj = rs.getObject("latitude")
                        val lat = (latObj as? Number)?.toDouble()
                        val lngObj = rs.getObject("longitude")
                        val lng = (lngObj as? Number)?.toDouble()
                        val coordStatus = if (lat != null && lng != null) "present" else "missing"

                        val rawPayloadStr = rs.getString("raw_payload")
                        val safeMetadata: JsonElement? = if (!rawPayloadStr.isNullOrBlank()) {
                            try {
                                json.parseToJsonElement(rawPayloadStr)
                            } catch (_: Exception) {
                                null
                            }
                        } else null
                        val priceEvidence = parseJsonElement(rs.getString("price_evidence"))

                        detail = PlaceDetailDto(
                            id = rs.getString("id"),
                            name = rs.getString("name"),
                            source = rs.getString("source"),
                            sourcePlaceId = rs.getString("source_place_id"),
                            category = rs.getString("category"),
                            rawCategory = rs.getString("raw_category"),
                            district = rs.getString("district"),
                            address = rs.getString("address"),
                            roadAddress = rs.getString("road_address"),
                            latitude = lat,
                            longitude = lng,
                            coordinateStatus = coordStatus,
                            estimatedCostKrw = (rs.getObject("estimated_cost_krw") as? Number)?.toInt(),
                            priceEvidenceSource = priceEvidenceSource(priceEvidence),
                            priceEvidenceVerificationStatus = priceEvidenceVerificationStatus(priceEvidence),
                            priceEvidence = sanitizeMetadata(priceEvidence),
                            tourismMetricCount = 0,
                            latestTourismPeriod = null,
                            tourismMetrics = emptyList(),
                            safeMetadata = sanitizeMetadata(safeMetadata),
                            createdAt = rs.getTimestamp("created_at").toInstant().toString(),
                            updatedAt = rs.getTimestamp("updated_at").toInstant().toString()
                        )
                    }
                }
            }

            if (detail == null) {
                throw ResourceNotFoundException(
                    code = "ADMIN_PLACE_NOT_FOUND",
                    message = "장소를 찾을 수 없습니다: $id"
                )
            }

            // Fetch metrics
            val metricSql = """
                SELECT 
                    tm.metric_type,
                    tm.value,
                    tm.unit,
                    tm.period_start,
                    tm.period_end,
                    ds.name as source_name
                FROM tourism_metrics tm
                LEFT JOIN tourism_data_sources ds ON tm.source_id = ds.id
                WHERE tm.place_id = ?
                ORDER BY tm.period_end DESC NULLS LAST, tm.created_at DESC
                LIMIT 50
            """.trimIndent()

            val metrics = mutableListOf<TourismMetricSummaryDto>()
            var latestPeriod: String? = null

            conn.prepareStatement(metricSql).use { stmt ->
                stmt.setObject(1, placeUuid)
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        val pStart = rs.getDate("period_start")?.toString()
                        val pEnd = rs.getDate("period_end")?.toString()
                        if (latestPeriod == null && pEnd != null) {
                            latestPeriod = pEnd
                        }
                        metrics.add(
                            TourismMetricSummaryDto(
                                metricType = rs.getString("metric_type"),
                                value = rs.getDouble("value"),
                                unit = rs.getString("unit"),
                                periodStart = pStart,
                                periodEnd = pEnd,
                                sourceName = rs.getString("source_name")
                            )
                        )
                    }
                }
            }

            detail!!.copy(
                tourismMetricCount = metrics.size.toLong(),
                latestTourismPeriod = latestPeriod,
                tourismMetrics = metrics
            )
        }
    }

    private fun mapPlaceListItem(rs: ResultSet): PlaceListItemDto {
        val latObj = rs.getObject("latitude")
        val lat = (latObj as? Number)?.toDouble()
        val lngObj = rs.getObject("longitude")
        val lng = (lngObj as? Number)?.toDouble()
        val coordStatus = if (lat != null && lng != null) "present" else "missing"

        return PlaceListItemDto(
            id = rs.getString("id"),
            name = rs.getString("name"),
            source = rs.getString("source"),
            sourcePlaceId = rs.getString("source_place_id"),
            category = rs.getString("category"),
            address = rs.getString("address"),
            roadAddress = rs.getString("road_address"),
            latitude = lat,
            longitude = lng,
            coordinateStatus = coordStatus,
            estimatedCostKrw = (rs.getObject("estimated_cost_krw") as? Number)?.toInt(),
            priceEvidenceSource = rs.getString("price_evidence_source"),
            priceEvidenceVerificationStatus = rs.getString("price_evidence_verification_status"),
            tourismMetricCount = rs.getLong("metric_count"),
            latestTourismPeriod = rs.getString("latest_period"),
            createdAt = rs.getTimestamp("created_at").toInstant().toString(),
            updatedAt = rs.getTimestamp("updated_at").toInstant().toString()
        )
    }

    private fun parseJsonElement(raw: String?): JsonElement? {
        if (raw.isNullOrBlank()) return null
        return try {
            json.parseToJsonElement(raw)
        } catch (_: Exception) {
            null
        }
    }

    internal fun sanitizeMetadata(element: JsonElement?): JsonElement? {
        val sensitiveKey = Regex("(?i)(password|secret|token|authorization|api[_-]?key|client[_-]?secret|credential)")
        return when (element) {
            is JsonObject -> JsonObject(
                element.entries
                    .filterNot { (key, _) -> sensitiveKey.containsMatchIn(key) }
                    .associate { (key, value) -> key to (sanitizeMetadata(value) ?: value) }
            )
            is JsonArray -> JsonArray(element.map { sanitizeMetadata(it) ?: it })
            else -> element
        }
    }

    private fun priceEvidenceSource(element: JsonElement?): String? {
        return (element as? JsonObject)?.get("source")?.toString()?.trim('"')
    }

    private fun priceEvidenceVerificationStatus(element: JsonElement?): String? {
        return (element as? JsonObject)?.get("verificationStatus")?.toString()?.trim('"')
    }
}
