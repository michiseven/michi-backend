package com.michiseven.michi.admin.dashboard

import com.michiseven.michi.admin.database.withReadOnlyConnection
import kotlinx.serialization.Serializable
import javax.sql.DataSource

@Serializable
data class PlaceSummary(
    val total: Long,
    val withoutLocation: Long,
    val kto: Long,
    val naver: Long
)

@Serializable
data class TourismMetricsSummary(
    val total: Long,
    val linkedPlaces: Long,
    val latestReferencePeriod: String?
)

@Serializable
data class ImportsSummary(
    val latestCompletedAt: String?,
    val latestStatus: String?,
    val recentRejectCount: Long?
)

@Serializable
data class EvaluationsSummary(
    val total: Long,
    val latestGeneratedAt: String?
)

@Serializable
data class AdminDashboardSummary(
    val places: PlaceSummary,
    val tourismMetrics: TourismMetricsSummary,
    val imports: ImportsSummary,
    val evaluations: EvaluationsSummary
)

class DashboardRepository(private val dataSource: DataSource) {

    fun getSummary(): AdminDashboardSummary {
        return dataSource.withReadOnlyConnection { conn ->
            // Places summary
            var totalPlaces = 0L
            var withoutLocation = 0L
            var ktoPlaces = 0L
            var naverPlaces = 0L

            val placeSql = """
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE location IS NULL) as without_location,
                    COUNT(*) FILTER (WHERE source = 'kto') as kto_count,
                    COUNT(*) FILTER (WHERE source = 'naver') as naver_count
                FROM places
            """.trimIndent()

            conn.prepareStatement(placeSql).use { stmt ->
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        totalPlaces = rs.getLong("total")
                        withoutLocation = rs.getLong("without_location")
                        ktoPlaces = rs.getLong("kto_count")
                        naverPlaces = rs.getLong("naver_count")
                    }
                }
            }

            // Tourism metrics summary
            var totalMetrics = 0L
            var linkedPlaces = 0L
            var latestRefPeriod: String? = null

            val metricSql = """
                SELECT 
                    COUNT(*) as total,
                    COUNT(DISTINCT place_id) FILTER (WHERE place_id IS NOT NULL) as linked_places,
                    MAX(period_end) as latest_period_end
                FROM tourism_metrics
            """.trimIndent()

            conn.prepareStatement(metricSql).use { stmt ->
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        totalMetrics = rs.getLong("total")
                        linkedPlaces = rs.getLong("linked_places")
                        val date = rs.getDate("latest_period_end")
                        if (date != null) {
                            latestRefPeriod = date.toString()
                        }
                    }
                }
            }

            // If latestRefPeriod was null in date, also check import_runs reference_period
            if (latestRefPeriod == null) {
                val refPeriodSql = "SELECT reference_period FROM tourism_import_runs WHERE reference_period IS NOT NULL ORDER BY completed_at DESC NULLS LAST LIMIT 1"
                conn.prepareStatement(refPeriodSql).use { stmt ->
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) {
                            latestRefPeriod = rs.getString("reference_period")
                        }
                    }
                }
            }

            // Imports summary
            var latestCompletedAt: String? = null
            var latestStatus: String? = null
            var recentRejectCount: Long? = null

            val importSql = """
                SELECT completed_at, status, rejected_count
                FROM tourism_import_runs
                ORDER BY started_at DESC
                LIMIT 1
            """.trimIndent()

            conn.prepareStatement(importSql).use { stmt ->
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        val ts = rs.getTimestamp("completed_at")
                        latestCompletedAt = ts?.toInstant()?.toString()
                        latestStatus = rs.getString("status")
                        recentRejectCount = rs.getLong("rejected_count")
                    }
                }
            }

            // Evaluations summary
            var totalEvaluations = 0L
            var latestGeneratedAt: String? = null

            val evalSql = """
                SELECT COUNT(*) as total, MAX(generated_at) as latest_gen
                FROM recommendation_evaluations
            """.trimIndent()

            conn.prepareStatement(evalSql).use { stmt ->
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        totalEvaluations = rs.getLong("total")
                        val ts = rs.getTimestamp("latest_gen")
                        latestGeneratedAt = ts?.toInstant()?.toString()
                    }
                }
            }

            AdminDashboardSummary(
                places = PlaceSummary(
                    total = totalPlaces,
                    withoutLocation = withoutLocation,
                    kto = ktoPlaces,
                    naver = naverPlaces
                ),
                tourismMetrics = TourismMetricsSummary(
                    total = totalMetrics,
                    linkedPlaces = linkedPlaces,
                    latestReferencePeriod = latestRefPeriod
                ),
                imports = ImportsSummary(
                    latestCompletedAt = latestCompletedAt,
                    latestStatus = latestStatus,
                    recentRejectCount = recentRejectCount
                ),
                evaluations = EvaluationsSummary(
                    total = totalEvaluations,
                    latestGeneratedAt = latestGeneratedAt
                )
            )
        }
    }
}
