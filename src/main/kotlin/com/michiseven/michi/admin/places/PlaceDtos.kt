package com.michiseven.michi.admin.places

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class PlaceListItemDto(
    val id: String,
    val name: String,
    val source: String,
    val sourcePlaceId: String,
    val category: String?,
    val address: String?,
    val roadAddress: String?,
    val latitude: Double?,
    val longitude: Double?,
    val coordinateStatus: String,
    val estimatedCostKrw: Int?,
    val priceEvidenceSource: String?,
    val priceEvidenceVerificationStatus: String?,
    val tourismMetricCount: Long,
    val latestTourismPeriod: String?,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class TourismMetricSummaryDto(
    val metricType: String,
    val value: Double,
    val unit: String,
    val periodStart: String?,
    val periodEnd: String?,
    val sourceName: String?
)

@Serializable
data class PlaceDetailDto(
    val id: String,
    val name: String,
    val source: String,
    val sourcePlaceId: String,
    val category: String?,
    val rawCategory: String?,
    val district: String?,
    val address: String?,
    val roadAddress: String?,
    val latitude: Double?,
    val longitude: Double?,
    val coordinateStatus: String,
    val estimatedCostKrw: Int?,
    val priceEvidenceSource: String?,
    val priceEvidenceVerificationStatus: String?,
    val priceEvidence: JsonElement?,
    val tourismMetricCount: Long,
    val latestTourismPeriod: String?,
    val tourismMetrics: List<TourismMetricSummaryDto>,
    val safeMetadata: JsonElement?,
    val createdAt: String,
    val updatedAt: String
)

data class PlaceFilter(
    val query: String? = null,
    val provider: String? = null,
    val category: String? = null,
    val coordinateStatus: String? = null, // all | present | missing
    val tourismMetricStatus: String? = null, // all | linked | unlinked
    val priceEvidenceStatus: String? = null // all | verified | unverified | missing
)
