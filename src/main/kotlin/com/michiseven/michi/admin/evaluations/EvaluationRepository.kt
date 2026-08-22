package com.michiseven.michi.admin.evaluations

import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import com.michiseven.michi.admin.common.ResourceNotFoundException
import com.michiseven.michi.admin.database.withReadOnlyConnection
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID
import javax.sql.DataSource

class EvaluationRepository(private val dataSource: DataSource) {
    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        val ALLOWED_SORTS = mapOf(
            "createdAt" to "generated_at",
            "dataMode" to "data_mode"
        )
    }

    fun findEvaluations(filter: EvaluationFilter, pageRequest: PageRequest): PageResponse<EvaluationListItemDto> {
        return dataSource.withReadOnlyConnection { conn ->
            val whereClauses = mutableListOf<String>()
            val params = mutableListOf<Any>()

            if (!filter.dataMode.isNullOrBlank() && filter.dataMode != "all") {
                whereClauses.add("data_mode = ?")
                params.add(filter.dataMode.trim())
            }

            val whereSql = if (whereClauses.isNotEmpty()) "WHERE " + whereClauses.joinToString(" AND ") else ""

            val countSql = "SELECT COUNT(*) FROM recommendation_evaluations $whereSql"
            var totalItems = 0L
            conn.prepareStatement(countSql).use { stmt ->
                params.forEachIndexed { index, param -> stmt.setObject(index + 1, param) }
                stmt.executeQuery().use { rs ->
                    if (rs.next()) totalItems = rs.getLong(1)
                }
            }

            val sortColumn = ALLOWED_SORTS[pageRequest.sort] ?: "generated_at"
            val directionSql = pageRequest.direction.sql

            val listSql = """
                SELECT 
                    id,
                    generated_at,
                    preference_snapshot,
                    candidate_snapshot,
                    data_mode,
                    baseline_algorithm_version,
                    michi_algorithm_version,
                    baseline_metrics,
                    michi_metrics
                FROM recommendation_evaluations
                $whereSql
                ORDER BY $sortColumn $directionSql, id DESC
                LIMIT ? OFFSET ?
            """.trimIndent()

            val items = mutableListOf<EvaluationListItemDto>()
            conn.prepareStatement(listSql).use { stmt ->
                var paramIdx = 1
                params.forEach { param ->
                    stmt.setObject(paramIdx++, param)
                }
                stmt.setInt(paramIdx++, pageRequest.pageSize)
                stmt.setLong(paramIdx, pageRequest.offset)

                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        val prefStr = rs.getString("preference_snapshot")
                        val candStr = rs.getString("candidate_snapshot")
                        val baseMetricsStr = rs.getString("baseline_metrics")
                        val michiMetricsStr = rs.getString("michi_metrics")

                        var area: String? = null
                        var travelDate: String? = null
                        if (!prefStr.isNullOrBlank()) {
                            try {
                                val prefObj = json.parseToJsonElement(prefStr).jsonObject
                                area = prefObj["area"]?.jsonPrimitive?.content
                                travelDate = prefObj["travelDate"]?.jsonPrimitive?.content
                            } catch (_: Exception) {
                            }
                        }

                        var candidateCount = 0
                        if (!candStr.isNullOrBlank()) {
                            try {
                                candidateCount = json.parseToJsonElement(candStr).jsonArray.size
                            } catch (_: Exception) {
                            }
                        }

                        val baseMetrics = parseMetrics(baseMetricsStr)
                        val michiMetrics = parseMetrics(michiMetricsStr)
                        val expected = ExpectedDispersionEffectCalculator.calculate(baseMetrics, michiMetrics)

                        items.add(
                            EvaluationListItemDto(
                                id = rs.getString("id"),
                                createdAt = rs.getTimestamp("generated_at").toInstant().toString(),
                                area = area,
                                travelDate = travelDate,
                                dataMode = rs.getString("data_mode"),
                                evidenceStatus = expected.evidenceStatus,
                                candidateCount = candidateCount,
                                baselineAlgorithmVersion = rs.getString("baseline_algorithm_version"),
                                michiAlgorithmVersion = rs.getString("michi_algorithm_version")
                            )
                        )
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

    fun findEvaluationById(id: String): EvaluationDetailDto {
        val evalUuid = try {
            UUID.fromString(id)
        } catch (_: Exception) {
            throw ResourceNotFoundException(
                code = "ADMIN_EVALUATION_NOT_FOUND",
                message = "추천 평가를 찾을 수 없습니다: $id"
            )
        }

        return dataSource.withReadOnlyConnection { conn ->
            val sql = """
                SELECT 
                    id,
                    generated_at,
                    preference_snapshot,
                    candidate_snapshot,
                    data_mode,
                    baseline_algorithm_version,
                    michi_algorithm_version,
                    baseline_metrics,
                    michi_metrics,
                    delta,
                    source_snapshot,
                    random_seed
                FROM recommendation_evaluations
                WHERE id = ?
            """.trimIndent()

            conn.prepareStatement(sql).use { stmt ->
                stmt.setObject(1, evalUuid)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        val prefStr = rs.getString("preference_snapshot")
                        val candStr = rs.getString("candidate_snapshot")
                        val baseMetricsStr = rs.getString("baseline_metrics")
                        val michiMetricsStr = rs.getString("michi_metrics")
                        val deltaStr = rs.getString("delta")
                        val sourceStr = rs.getString("source_snapshot")

                        val prefJson = prefStr?.let { safeParseJson(it) }
                        val candJson = candStr?.let { safeParseJson(it) }
                        val sourceJson = sourceStr?.let { safeParseJson(it) }

                        var area: String? = null
                        var travelDate: String? = null
                        if (prefJson != null) {
                            try {
                                val obj = prefJson.jsonObject
                                area = obj["area"]?.jsonPrimitive?.content
                                travelDate = obj["travelDate"]?.jsonPrimitive?.content
                            } catch (_: Exception) {
                            }
                        }

                        var candidateCount = 0
                        var withConcentration = 0
                        val sources = mutableSetOf<String>()
                        if (candJson != null) {
                            try {
                                val arr = candJson.jsonArray
                                candidateCount = arr.size
                                arr.forEach { elem ->
                                    val obj = elem.jsonObject
                                    obj["source"]?.jsonPrimitive?.content?.let { sources.add(it) }
                                    if (obj["tourismConcentration"]?.jsonPrimitive?.content != null &&
                                        obj["tourismConcentration"]?.jsonPrimitive?.content != "null"
                                    ) {
                                        withConcentration++
                                    }
                                }
                            } catch (_: Exception) {
                            }
                        }

                        val baseSourceValues = parseMetrics(baseMetricsStr)
                        val michiSourceValues = parseMetrics(michiMetricsStr)
                        val expected = ExpectedDispersionEffectCalculator.calculate(baseSourceValues, michiSourceValues)

                        val baseMetricsMap = parseMetricsMap(baseMetricsStr)
                        val michiMetricsMap = parseMetricsMap(michiMetricsStr)
                        val deltaMap = parseMetricsMap(deltaStr)

                        val warnings = mutableListOf<String>()
                        val dataMode = rs.getString("data_mode")
                        if (dataMode == "mock" || dataMode == "mixed") {
                            warnings.add("MOCK 관광 데이터가 포함된 결과는 실제 성과가 아닙니다.")
                        }
                        warnings.add("이동 거리와 시간은 실제 길찾기가 아닌 직선거리·보행속도 기반 추정치입니다.")

                        EvaluationDetailDto(
                            id = rs.getString("id"),
                            createdAt = rs.getTimestamp("generated_at").toInstant().toString(),
                            area = area,
                            travelDate = travelDate,
                            dataMode = dataMode,
                            preferenceSnapshot = prefJson,
                            candidateSnapshotSummary = CandidateSnapshotSummaryDto(
                                totalCandidates = candidateCount,
                                withTourismConcentration = withConcentration,
                                sources = sources.toList().sorted()
                            ),
                            baselineAlgorithmVersion = rs.getString("baseline_algorithm_version"),
                            michiAlgorithmVersion = rs.getString("michi_algorithm_version"),
                            baselineMetrics = baseMetricsMap,
                            michiMetrics = michiMetricsMap,
                            delta = deltaMap,
                            expectedEffect = expected,
                            dataSources = sourceJson,
                            warnings = warnings,
                            randomSeed = rs.getObject("random_seed") as? Int
                        )
                    } else {
                        throw ResourceNotFoundException(
                            code = "ADMIN_EVALUATION_NOT_FOUND",
                            message = "추천 평가를 찾을 수 없습니다: $id"
                        )
                    }
                }
            }
        }
    }

    private fun safeParseJson(str: String): JsonElement? {
        return try {
            json.parseToJsonElement(str)
        } catch (_: Exception) {
            null
        }
    }

    private fun parseMetrics(str: String?): MetricSourceValues {
        if (str.isNullOrBlank()) return MetricSourceValues()
        return try {
            val obj = json.parseToJsonElement(str).jsonObject
            MetricSourceValues(
                averagePreferenceScore = obj["averagePreferenceScore"]?.jsonPrimitive?.content?.toDoubleOrNull(),
                tourismConcentrationScore = obj["tourismConcentrationScore"]?.jsonPrimitive?.content?.toDoubleOrNull(),
                nonHotspotInclusionRate = obj["nonHotspotInclusionRate"]?.jsonPrimitive?.content?.toDoubleOrNull(),
                averageTravelDistanceKm = obj["averageTravelDistanceKm"]?.jsonPrimitive?.content?.toDoubleOrNull(),
                averageTravelTimeMinutes = obj["averageTravelTimeMinutes"]?.jsonPrimitive?.content?.toDoubleOrNull(),
                localImpactScore = obj["localImpactScore"]?.jsonPrimitive?.content?.toDoubleOrNull()
            )
        } catch (_: Exception) {
            MetricSourceValues()
        }
    }

    private fun parseMetricsMap(str: String?): Map<String, Double?> {
        if (str.isNullOrBlank()) return emptyMap()
        return try {
            val map = mutableMapOf<String, Double?>()
            val obj = json.parseToJsonElement(str).jsonObject
            obj.forEach { (k, v) ->
                map[k] = v.jsonPrimitive.content.toDoubleOrNull()
            }
            map
        } catch (_: Exception) {
            emptyMap()
        }
    }
}
