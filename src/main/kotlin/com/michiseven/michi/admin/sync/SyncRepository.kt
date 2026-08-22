package com.michiseven.michi.admin.sync

import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.PageResponse
import com.michiseven.michi.admin.common.ResourceNotFoundException
import com.michiseven.michi.admin.database.withReadOnlyConnection
import java.util.UUID
import javax.sql.DataSource

class SyncRepository(private val dataSource: DataSource) {

    fun getSyncJobs(): List<SyncJobDto> {
        return dataSource.withReadOnlyConnection { conn ->
            // DataLab import runs history check
            var dataLabLastRun: String? = null
            var dataLabLastStatus: String? = null
            val dataLabSql = """
                SELECT started_at, status
                FROM tourism_import_runs
                ORDER BY started_at DESC
                LIMIT 1
            """.trimIndent()

            conn.prepareStatement(dataLabSql).use { stmt ->
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        dataLabLastRun = rs.getTimestamp("started_at").toInstant().toString()
                        dataLabLastStatus = rs.getString("status")
                    }
                }
            }

            listOf(
                SyncJobDto(
                    key = "kto-seoul-poi",
                    name = "KTO 서울 관광지 POI 동기화",
                    description = "한국관광공사 TourAPI를 통한 서울 전역 관광지·음식점·숙박 POI 메타데이터 동기화",
                    schedule = "수동 실행",
                    historyStatus = "unavailable",
                    lastRunAt = null,
                    lastStatus = null
                ),
                SyncJobDto(
                    key = "kto-datalab-concentration",
                    name = "한국관광 데이터랩 집중도 동기화",
                    description = "한국관광 데이터랩 방문·소비·관광 흐름 데이터셋 정기 Import 및 관광 지표 feature store 적재",
                    schedule = "매월 1회 / 수동 실행",
                    historyStatus = if (dataLabLastRun != null) "available" else "unavailable",
                    lastRunAt = dataLabLastRun,
                    lastStatus = dataLabLastStatus
                )
            )
        }
    }

    fun getSyncRuns(jobKey: String?, pageRequest: PageRequest): PageResponse<SyncRunDto> {
        // Since KTO POI sync runs are not tracked in a dedicated run table,
        // and DataLab is tracked in tourism_import_runs, we map tourism_import_runs for dataLab
        // and return empty for KTO with historyStatus="unavailable".
        if (jobKey == "kto-seoul-poi") {
            return PageResponse(
                items = emptyList(),
                page = pageRequest.page,
                pageSize = pageRequest.pageSize,
                totalItems = 0,
                totalPages = 0
            )
        }

        return dataSource.withReadOnlyConnection { conn ->
            val countSql = "SELECT COUNT(*) FROM tourism_import_runs"
            var totalItems = 0L
            conn.prepareStatement(countSql).use { stmt ->
                stmt.executeQuery().use { rs ->
                    if (rs.next()) totalItems = rs.getLong(1)
                }
            }

            val listSql = """
                SELECT id, started_at, completed_at, status, file_name, accepted_count, rejected_count
                FROM tourism_import_runs
                ORDER BY started_at DESC
                LIMIT ? OFFSET ?
            """.trimIndent()

            val items = mutableListOf<SyncRunDto>()
            conn.prepareStatement(listSql).use { stmt ->
                stmt.setInt(1, pageRequest.pageSize)
                stmt.setLong(2, pageRequest.offset)
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        val accepted = rs.getInt("accepted_count")
                        val rejected = rs.getInt("rejected_count")
                        val fileName = rs.getString("file_name")
                        items.add(
                            SyncRunDto(
                                id = rs.getString("id"),
                                jobKey = "kto-datalab-concentration",
                                startedAt = rs.getTimestamp("started_at").toInstant().toString(),
                                completedAt = rs.getTimestamp("completed_at")?.toInstant()?.toString(),
                                status = rs.getString("status"),
                                message = "파일: $fileName, 적재: $accepted, 거절: $rejected"
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

    fun getSyncRunById(id: String): SyncRunDto {
        val runUuid = try {
            UUID.fromString(id)
        } catch (_: Exception) {
            throw ResourceNotFoundException(
                code = "ADMIN_SYNC_RUN_NOT_FOUND",
                message = "동기화 실행 이력을 찾을 수 없습니다: $id"
            )
        }

        return dataSource.withReadOnlyConnection { conn ->
            val sql = """
                SELECT id, started_at, completed_at, status, file_name, accepted_count, rejected_count
                FROM tourism_import_runs
                WHERE id = ?
            """.trimIndent()

            conn.prepareStatement(sql).use { stmt ->
                stmt.setObject(1, runUuid)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        val accepted = rs.getInt("accepted_count")
                        val rejected = rs.getInt("rejected_count")
                        val fileName = rs.getString("file_name")
                        SyncRunDto(
                            id = rs.getString("id"),
                            jobKey = "kto-datalab-concentration",
                            startedAt = rs.getTimestamp("started_at").toInstant().toString(),
                            completedAt = rs.getTimestamp("completed_at")?.toInstant()?.toString(),
                            status = rs.getString("status"),
                            message = "파일: $fileName, 적재: $accepted, 거절: $rejected"
                        )
                    } else {
                        throw ResourceNotFoundException(
                            code = "ADMIN_SYNC_RUN_NOT_FOUND",
                            message = "동기화 실행 이력을 찾을 수 없습니다: $id"
                        )
                    }
                }
            }
        }
    }
}
