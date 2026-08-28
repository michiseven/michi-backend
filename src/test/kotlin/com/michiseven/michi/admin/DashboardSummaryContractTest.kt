package com.michiseven.michi.admin

import com.michiseven.michi.admin.dashboard.AdminDashboardSummary
import com.michiseven.michi.admin.dashboard.EvaluationsSummary
import com.michiseven.michi.admin.dashboard.ImportsSummary
import com.michiseven.michi.admin.dashboard.MembersSummary
import com.michiseven.michi.admin.dashboard.PlaceSummary
import com.michiseven.michi.admin.dashboard.TourismMetricsSummary
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class DashboardSummaryContractTest {

    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }

    @Test
    fun `serializes summary matching frontend api contract`() {
        val summary = AdminDashboardSummary(
            places = PlaceSummary(
                total = 699,
                withoutLocation = 3,
                kto = 683,
                naver = 15,
                kakao = 1,
                mock = 0,
                other = 0,
                verifiedPriceRecords = 7,
                unverifiedPriceRecords = 5,
                bySource = mapOf("kto-tour-jpn" to 683, "naver-local" to 15, "kakao-local" to 1)
            ),
            tourismMetrics = TourismMetricsSummary(
                total = 3288,
                linkedPlaces = 137,
                latestReferencePeriod = "2026-09-13"
            ),
            imports = ImportsSummary(
                latestCompletedAt = "2026-08-21T18:00:00Z",
                latestStatus = "completed",
                recentRejectCount = 0
            ),
            evaluations = EvaluationsSummary(
                total = 5,
                latestGeneratedAt = "2026-08-21T18:15:00Z"
            ),
            members = MembersSummary(
                total = 12,
                active = 11,
                savedTrips = 7,
                latestRegisteredAt = "2026-08-22T01:00:00Z"
            )
        )

        val jsonStr = json.encodeToString(AdminDashboardSummary.serializer(), summary)
        val parsed = json.parseToJsonElement(jsonStr).jsonObject

        val placesObj = parsed["places"]?.jsonObject
        assertNotNull(placesObj)
        assertEquals(699L, placesObj["total"]?.jsonPrimitive?.long)
        assertEquals(3L, placesObj["withoutLocation"]?.jsonPrimitive?.long)
        assertEquals(683L, placesObj["kto"]?.jsonPrimitive?.long)
        assertEquals(15L, placesObj["naver"]?.jsonPrimitive?.long)
        assertEquals(1L, placesObj["kakao"]?.jsonPrimitive?.long)
        assertEquals(0L, placesObj["mock"]?.jsonPrimitive?.long)
        assertEquals(7L, placesObj["verifiedPriceRecords"]?.jsonPrimitive?.long)
        assertEquals(5L, placesObj["unverifiedPriceRecords"]?.jsonPrimitive?.long)

        val metricsObj = parsed["tourismMetrics"]?.jsonObject
        assertNotNull(metricsObj)
        assertEquals(3288L, metricsObj["total"]?.jsonPrimitive?.long)
        assertEquals(137L, metricsObj["linkedPlaces"]?.jsonPrimitive?.long)
        assertEquals("2026-09-13", metricsObj["latestReferencePeriod"]?.jsonPrimitive?.content)

        val importsObj = parsed["imports"]?.jsonObject
        assertNotNull(importsObj)
        assertEquals("2026-08-21T18:00:00Z", importsObj["latestCompletedAt"]?.jsonPrimitive?.content)
        assertEquals("completed", importsObj["latestStatus"]?.jsonPrimitive?.content)
        assertEquals(0L, importsObj["recentRejectCount"]?.jsonPrimitive?.long)

        val evalsObj = parsed["evaluations"]?.jsonObject
        assertNotNull(evalsObj)
        assertEquals(5L, evalsObj["total"]?.jsonPrimitive?.long)
        assertEquals("2026-08-21T18:15:00Z", evalsObj["latestGeneratedAt"]?.jsonPrimitive?.content)

        val membersObj = parsed["members"]?.jsonObject
        assertNotNull(membersObj)
        assertEquals(12L, membersObj["total"]?.jsonPrimitive?.long)
        assertEquals(7L, membersObj["savedTrips"]?.jsonPrimitive?.long)
    }
}
