package com.michiseven.michi.admin.dashboard

import com.michiseven.michi.admin.database.withReadOnlyConnection
import com.michiseven.michi.admin.places.PlaceSources
import kotlinx.serialization.Serializable
import javax.sql.DataSource

@Serializable
data class PlaceSummary(
    val total: Long,
    val withoutLocation: Long,
    val kto: Long,
    val naver: Long,
    val kakao: Long,
    val mock: Long,
    val other: Long,
    val verifiedPriceRecords: Long,
    val unverifiedPriceRecords: Long,
    val bySource: Map<String, Long>
)

@Serializable
data class MembersSummary(
    val total: Long,
    val active: Long,
    val savedTrips: Long,
    val latestRegisteredAt: String?
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
    val evaluations: EvaluationsSummary,
    val members: MembersSummary
)

class DashboardRepository(private val dataSource: DataSource) {

    fun getSummary(): AdminDashboardSummary {
        return dataSource.withReadOnlyConnection { conn ->
            // 장소 제공자는 고정 목록이 아니라 DB의 실제 source 값을 기준으로 집계한다.
            var totalPlaces = 0L
            var withoutLocation = 0L
            var ktoPlaces = 0L
            var naverPlaces = 0L
            var kakaoPlaces = 0L
            var mockPlaces = 0L
            var verifiedPriceRecords = 0L
            var unverifiedPriceRecords = 0L
            val bySource = linkedMapOf<String, Long>()

            val placeSql = """
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE location IS NULL) as without_location,
                    COUNT(*) FILTER (WHERE source = ?) as kto_count,
                    COUNT(*) FILTER (WHERE source = ?) as naver_count,
                    COUNT(*) FILTER (WHERE source = ?) as kakao_count,
                    COUNT(*) FILTER (WHERE source = ?) as mock_count,
                    COUNT(*) FILTER (
                        WHERE estimated_cost_krw IS NOT NULL
                          AND price_evidence->>'verificationStatus' = 'verified'
                          AND price_evidence->>'source' IN ('kakao-place-menu', 'kto-detail', 'manual')
                    ) as verified_price_records,
                    COUNT(*) FILTER (
                        WHERE (estimated_cost_krw IS NOT NULL OR price_evidence IS NOT NULL)
                          AND NOT (
                            estimated_cost_krw IS NOT NULL
                            AND price_evidence->>'verificationStatus' = 'verified'
                            AND price_evidence->>'source' IN ('kakao-place-menu', 'kto-detail', 'manual')
                          )
                    ) as unverified_price_records
                FROM places
            """.trimIndent()

            conn.prepareStatement(placeSql).use { stmt ->
                stmt.setString(1, PlaceSources.KTO)
                stmt.setString(2, PlaceSources.NAVER)
                stmt.setString(3, PlaceSources.KAKAO)
                stmt.setString(4, PlaceSources.MOCK)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        totalPlaces = rs.getLong("total")
                        withoutLocation = rs.getLong("without_location")
                        ktoPlaces = rs.getLong("kto_count")
                        naverPlaces = rs.getLong("naver_count")
                        kakaoPlaces = rs.getLong("kakao_count")
                        mockPlaces = rs.getLong("mock_count")
                        verifiedPriceRecords = rs.getLong("verified_price_records")
                        unverifiedPriceRecords = rs.getLong("unverified_price_records")
                    }
                }
            }

            conn.prepareStatement("SELECT source, COUNT(*) AS count FROM places GROUP BY source ORDER BY source").use { stmt ->
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        bySource[rs.getString("source")] = rs.getLong("count")
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

            var totalMembers = 0L
            var activeMembers = 0L
            var savedTrips = 0L
            var latestRegisteredAt: String? = null
            conn.prepareStatement(
                """
                    SELECT
                        (SELECT COUNT(*) FROM users) AS total,
                        (SELECT COUNT(*) FROM users WHERE is_active = true) AS active,
                        (SELECT COUNT(*) FROM user_saved_trips) AS saved_trips,
                        (SELECT MAX(created_at) FROM users) AS latest_registered_at
                """.trimIndent()
            ).use { stmt ->
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        totalMembers = rs.getLong("total")
                        activeMembers = rs.getLong("active")
                        savedTrips = rs.getLong("saved_trips")
                        latestRegisteredAt = rs.getTimestamp("latest_registered_at")?.toInstant()?.toString()
                    }
                }
            }

            AdminDashboardSummary(
                places = PlaceSummary(
                    total = totalPlaces,
                    withoutLocation = withoutLocation,
                    kto = ktoPlaces,
                    naver = naverPlaces,
                    kakao = kakaoPlaces,
                    mock = mockPlaces,
                    other = totalPlaces - ktoPlaces - naverPlaces - kakaoPlaces - mockPlaces,
                    verifiedPriceRecords = verifiedPriceRecords,
                    unverifiedPriceRecords = unverifiedPriceRecords,
                    bySource = bySource
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
                ),
                members = MembersSummary(
                    total = totalMembers,
                    active = activeMembers,
                    savedTrips = savedTrips,
                    latestRegisteredAt = latestRegisteredAt
                )
            )
        }
    }
}
