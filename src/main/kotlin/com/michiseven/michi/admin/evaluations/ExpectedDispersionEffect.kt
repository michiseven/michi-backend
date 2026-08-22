package com.michiseven.michi.admin.evaluations

import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.math.RoundingMode

const val EXPECTED_DISPERSION_EFFECT_ALGORITHM_VERSION = "expected-dispersion-effect-v1"

@Serializable
data class ExpectedDispersionEffect(
    val algorithmVersion: String,
    val claimScope: String = "recommendation_estimate",
    val evidenceStatus: String, // available | partial | unavailable
    val concentrationReduction: Double?,
    val nonHotspotInclusionLift: Double?,
    val preferenceChange: Double?,
    val extraTravelDistanceKm: Double?,
    val extraTravelTimeMinutes: Double?,
    val localImpactLift: Double?
)

@Serializable
data class MetricSourceValues(
    val averagePreferenceScore: Double? = null,
    val tourismConcentrationScore: Double? = null,
    val nonHotspotInclusionRate: Double? = null,
    val averageTravelDistanceKm: Double? = null,
    val averageTravelTimeMinutes: Double? = null,
    val localImpactScore: Double? = null
)

object ExpectedDispersionEffectCalculator {

    private fun calculateDifference(left: Double?, right: Double?): Double? {
        if (left == null || right == null || !left.isFinite() || !right.isFinite()) {
            return null
        }
        return BigDecimal.valueOf(left - right)
            .setScale(6, RoundingMode.HALF_UP)
            .toDouble()
    }

    /**
     * Exact calculation logic identical to TypeScript backend:
     * - concentrationReduction = Baseline 관광 집중도 - Michi 관광 집중도
     * - nonHotspotInclusionLift = Michi 비핫스팟 포함률 - Baseline 비핫스팟 포함률
     * - preferenceChange = Michi 평균 취향 - Baseline 평균 취향
     * - extraTravelDistanceKm = Michi 평균 이동 거리 - Baseline 평균 이동 거리
     * - extraTravelTimeMinutes = Michi 평균 이동 시간 - Baseline 평균 이동 시간
     * - localImpactLift = Michi 로컬 임팩트 - Baseline 로컬 임팩트
     */
    fun calculate(
        baseline: MetricSourceValues,
        michi: MetricSourceValues
    ): ExpectedDispersionEffect {
        val concentrationReduction = calculateDifference(
            baseline.tourismConcentrationScore,
            michi.tourismConcentrationScore
        )

        val nonHotspotInclusionLift = calculateDifference(
            michi.nonHotspotInclusionRate,
            baseline.nonHotspotInclusionRate
        )

        val preferenceChange = calculateDifference(
            michi.averagePreferenceScore,
            baseline.averagePreferenceScore
        )

        val extraTravelDistanceKm = calculateDifference(
            michi.averageTravelDistanceKm,
            baseline.averageTravelDistanceKm
        )

        val extraTravelTimeMinutes = calculateDifference(
            michi.averageTravelTimeMinutes,
            baseline.averageTravelTimeMinutes
        )

        val localImpactLift = calculateDifference(
            michi.localImpactScore,
            baseline.localImpactScore
        )

        val allMetrics = listOf(
            concentrationReduction,
            nonHotspotInclusionLift,
            preferenceChange,
            extraTravelDistanceKm,
            extraTravelTimeMinutes,
            localImpactLift
        )

        val evidenceStatus = when {
            concentrationReduction != null && nonHotspotInclusionLift != null -> "available"
            allMetrics.any { it != null } -> "partial"
            else -> "unavailable"
        }

        return ExpectedDispersionEffect(
            algorithmVersion = EXPECTED_DISPERSION_EFFECT_ALGORITHM_VERSION,
            claimScope = "recommendation_estimate",
            evidenceStatus = evidenceStatus,
            concentrationReduction = concentrationReduction,
            nonHotspotInclusionLift = nonHotspotInclusionLift,
            preferenceChange = preferenceChange,
            extraTravelDistanceKm = extraTravelDistanceKm,
            extraTravelTimeMinutes = extraTravelTimeMinutes,
            localImpactLift = localImpactLift
        )
    }
}
