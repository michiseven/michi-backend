package com.michiseven.michi.admin.imports

import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import com.michiseven.michi.admin.common.ResourceNotFoundException
import com.michiseven.michi.admin.database.withReadOnlyConnection
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID
import javax.sql.DataSource

class ImportRepository(private val dataSource: DataSource) {
    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        val ALLOWED_SORTS = mapOf(
            "startedAt" to "r.started_at",
            "completedAt" to "r.completed_at",
            "datasetKey" to "s.dataset_key",
            "status" to "r.status"
        )
    }

    fun findImportRuns(filter: ImportRunFilter, pageRequest: PageRequest): PageResponse<ImportRunListItemDto> {
        return dataSource.withReadOnlyConnection { conn ->
            val whereClauses = mutableListOf<String>()
            val params = mutableListOf<Any>()

            if (!filter.datasetKey.isNullOrBlank() && filter.datasetKey != "all") {
                whereClauses.add("s.dataset_key = ?")
                params.add(filter.datasetKey.trim())
            }

            if (!filter.mode.isNullOrBlank() && filter.mode != "all") {
                whereClauses.add("r.mode = ?")
                params.add(filter.mode.trim())
            }

            if (!filter.status.isNullOrBlank() && filter.status != "all") {
                whereClauses.add("r.status = ?")
                params.add(filter.status.trim())
            }

            val whereSql = if (whereClauses.isNotEmpty()) "WHERE " + whereClauses.joinToString(" AND ") else ""

            val countSql = """
                SELECT COUNT(*) 
                FROM tourism_import_runs r
                JOIN tourism_data_sources s ON r.source_id = s.id
                $whereSql
            """.trimIndent()

            var totalItems = 0L
            conn.prepareStatement(countSql).use { stmt ->
                params.forEachIndexed { index, param -> stmt.setObject(index + 1, param) }
                stmt.executeQuery().use { rs ->
                    if (rs.next()) totalItems = rs.getLong(1)
                }
            }

            val sortColumn = ALLOWED_SORTS[pageRequest.sort] ?: "r.started_at"
            val directionSql = pageRequest.direction.sql

            val listSql = """
                SELECT 
                    r.id,
                    s.dataset_key,
                    s.name as dataset_name,
                    s.source_name,
                    r.reference_period,
                    r.mode,
                    r.status,
                    r.file_name,
                    r.accepted_count,
                    r.rejected_count,
                    r.started_at,
                    r.completed_at
                FROM tourism_import_runs r
                JOIN tourism_data_sources s ON r.source_id = s.id
                $whereSql
                ORDER BY $sortColumn $directionSql, r.id DESC
                LIMIT ? OFFSET ?
            """.trimIndent()

            val items = mutableListOf<ImportRunListItemDto>()
            conn.prepareStatement(listSql).use { stmt ->
                var paramIdx = 1
                params.forEach { param ->
                    stmt.setObject(paramIdx++, param)
                }
                stmt.setInt(paramIdx++, pageRequest.pageSize)
                stmt.setLong(paramIdx, pageRequest.offset)

                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        items.add(
                            ImportRunListItemDto(
                                id = rs.getString("id"),
                                datasetKey = rs.getString("dataset_key"),
                                datasetName = rs.getString("dataset_name"),
                                sourceName = rs.getString("source_name"),
                                referencePeriod = rs.getString("reference_period"),
                                mode = rs.getString("mode"),
                                status = rs.getString("status"),
                                fileName = rs.getString("file_name"),
                                acceptedCount = rs.getInt("accepted_count"),
                                rejectedCount = rs.getInt("rejected_count"),
                                startedAt = rs.getTimestamp("started_at").toInstant().toString(),
                                completedAt = rs.getTimestamp("completed_at")?.toInstant()?.toString()
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

    fun findImportRunById(id: String): ImportRunDetailDto {
        val runUuid = try {
            UUID.fromString(id)
        } catch (_: Exception) {
            throw ResourceNotFoundException(
                code = "ADMIN_IMPORT_RUN_NOT_FOUND",
                message = "Import 실행 이력을 찾을 수 없습니다: $id"
            )
        }

        return dataSource.withReadOnlyConnection { conn ->
            val sql = """
                SELECT 
                    r.id,
                    s.dataset_key,
                    s.name as dataset_name,
                    s.source_name,
                    s.url as source_url,
                    s.license_use_condition,
                    s.spatial_granularity,
                    s.temporal_granularity,
                    r.reference_period,
                    r.mode,
                    r.status,
                    r.file_name,
                    r.file_sha256,
                    r.accepted_count,
                    r.rejected_count,
                    r.started_at,
                    r.completed_at,
                    r.metadata as run_metadata
                FROM tourism_import_runs r
                JOIN tourism_data_sources s ON r.source_id = s.id
                WHERE r.id = ?
            """.trimIndent()

            conn.prepareStatement(sql).use { stmt ->
                stmt.setObject(1, runUuid)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        val fullSha = rs.getString("file_sha256") ?: ""
                        val checksumPrefix = if (fullSha.length >= 12) fullSha.substring(0, 12) else fullSha

                        val rawUrl = rs.getString("source_url")
                        val safeUrl = if (rawUrl != null && (rawUrl.startsWith("http://") || rawUrl.startsWith("https://"))) {
                            rawUrl
                        } else null

                        val metadataStr = rs.getString("run_metadata")
                        val metaJson: JsonElement? = if (!metadataStr.isNullOrBlank()) {
                            try {
                                json.parseToJsonElement(metadataStr)
                            } catch (_: Exception) {
                                null
                            }
                        } else null

                        // Extract rejection codes if present in metadata
                        val rejectionCounts = mutableMapOf<String, Int>()
                        if (metaJson != null) {
                            try {
                                val obj = metaJson.jsonObject
                                obj["rejectionCodeCounts"]?.jsonObject?.forEach { (k, v) ->
                                    v.jsonPrimitive.content.toIntOrNull()?.let { rejectionCounts[k] = it }
                                }
                            } catch (_: Exception) {
                            }
                        }

                        ImportRunDetailDto(
                            id = rs.getString("id"),
                            datasetKey = rs.getString("dataset_key"),
                            datasetName = rs.getString("dataset_name"),
                            sourceName = rs.getString("source_name"),
                            referencePeriod = rs.getString("reference_period"),
                            mode = rs.getString("mode"),
                            status = rs.getString("status"),
                            fileName = rs.getString("file_name"),
                            acceptedCount = rs.getInt("accepted_count"),
                            rejectedCount = rs.getInt("rejected_count"),
                            startedAt = rs.getTimestamp("started_at").toInstant().toString(),
                            completedAt = rs.getTimestamp("completed_at")?.toInstant()?.toString(),
                            sourceUrl = safeUrl,
                            licenseUseCondition = rs.getString("license_use_condition"),
                            spatialGranularity = rs.getString("spatial_granularity"),
                            temporalGranularity = rs.getString("temporal_granularity"),
                            checksumPrefix = checksumPrefix,
                            rejectionCodeCounts = rejectionCounts,
                            safeMetadata = metaJson
                        )
                    } else {
                        throw ResourceNotFoundException(
                            code = "ADMIN_IMPORT_RUN_NOT_FOUND",
                            message = "Import 실행 이력을 찾을 수 없습니다: $id"
                        )
                    }
                }
            }
        }
    }
}
