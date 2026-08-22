package com.michiseven.michi.admin.evaluations

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class EvaluationListItemDto(
    val id: String,
    val createdAt: String,
    val area: String?,
    val travelDate: String?,
    val dataMode: String,
    val evidenceStatus: String,
    val candidateCount: Int,
    val baselineAlgorithmVersion: String,
    val michiAlgorithmVersion: String
)

@Serializable
data class EvaluationDetailDto(
    val id: String,
    val createdAt: String,
    val area: String?,
    val travelDate: String?,
    val dataMode: String,
    val preferenceSnapshot: JsonElement?,
    val candidateSnapshotSummary: CandidateSnapshotSummaryDto,
    val baselineAlgorithmVersion: String,
    val michiAlgorithmVersion: String,
    val baselineMetrics: Map<String, Double?>,
    val michiMetrics: Map<String, Double?>,
    val delta: Map<String, Double?>,
    val expectedEffect: ExpectedDispersionEffect,
    val dataSources: JsonElement?,
    val warnings: List<String>,
    val randomSeed: Int?
)

@Serializable
data class CandidateSnapshotSummaryDto(
    val totalCandidates: Int,
    val withTourismConcentration: Int,
    val sources: List<String>
)

data class EvaluationFilter(
    val dataMode: String? = null
)
