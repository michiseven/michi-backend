package com.michiseven.michi.admin

import com.michiseven.michi.admin.evaluations.ExpectedDispersionEffectCalculator
import com.michiseven.michi.admin.evaluations.MetricSourceValues
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ExpectedDispersionEffectTest {

    @Test
    fun `calculates expected dispersion effect correctly matching TS implementation`() {
        val baseline = MetricSourceValues(
            averagePreferenceScore = 0.85,
            tourismConcentrationScore = 0.72,
            nonHotspotInclusionRate = 0.20,
            averageTravelDistanceKm = 3.5,
            averageTravelTimeMinutes = 45.0,
            localImpactScore = 0.40
        )

        val michi = MetricSourceValues(
            averagePreferenceScore = 0.82,
            tourismConcentrationScore = 0.45,
            nonHotspotInclusionRate = 0.60,
            averageTravelDistanceKm = 4.2,
            averageTravelTimeMinutes = 55.0,
            localImpactScore = 0.75
        )

        val effect = ExpectedDispersionEffectCalculator.calculate(baseline, michi)

        assertEquals("expected-dispersion-effect-v1", effect.algorithmVersion)
        assertEquals("recommendation_estimate", effect.claimScope)
        assertEquals("available", effect.evidenceStatus)

        // concentrationReduction = 0.72 - 0.45 = 0.27
        assertEquals(0.27, effect.concentrationReduction)
        // nonHotspotInclusionLift = 0.60 - 0.20 = 0.40
        assertEquals(0.40, effect.nonHotspotInclusionLift)
        // preferenceChange = 0.82 - 0.85 = -0.03
        assertEquals(-0.03, effect.preferenceChange)
        // extraTravelDistanceKm = 4.2 - 3.5 = 0.7
        assertEquals(0.7, effect.extraTravelDistanceKm)
        // extraTravelTimeMinutes = 55.0 - 45.0 = 10.0
        assertEquals(10.0, effect.extraTravelTimeMinutes)
        // localImpactLift = 0.75 - 0.40 = 0.35
        assertEquals(0.35, effect.localImpactLift)
    }

    @Test
    fun `preserves null values when metrics are missing`() {
        val baseline = MetricSourceValues(
            averagePreferenceScore = 0.85,
            tourismConcentrationScore = null,
            nonHotspotInclusionRate = null
        )

        val michi = MetricSourceValues(
            averagePreferenceScore = 0.80,
            tourismConcentrationScore = null,
            nonHotspotInclusionRate = null
        )

        val effect = ExpectedDispersionEffectCalculator.calculate(baseline, michi)

        assertEquals("partial", effect.evidenceStatus)
        assertNull(effect.concentrationReduction)
        assertNull(effect.nonHotspotInclusionLift)
        assertEquals(-0.05, effect.preferenceChange)
    }

    @Test
    fun `status is unavailable when all comparable values are null`() {
        val baseline = MetricSourceValues()
        val michi = MetricSourceValues()

        val effect = ExpectedDispersionEffectCalculator.calculate(baseline, michi)

        assertEquals("unavailable", effect.evidenceStatus)
        assertNull(effect.concentrationReduction)
        assertNull(effect.nonHotspotInclusionLift)
        assertNull(effect.preferenceChange)
        assertNull(effect.extraTravelDistanceKm)
        assertNull(effect.extraTravelTimeMinutes)
        assertNull(effect.localImpactLift)
    }
}
