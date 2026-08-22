package com.michiseven.michi.admin.imports

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class ImportRunListItemDto(
    val id: String,
    val datasetKey: String,
    val datasetName: String,
    val sourceName: String,
    val referencePeriod: String?,
    val mode: String,
    val status: String,
    val fileName: String,
    val acceptedCount: Int,
    val rejectedCount: Int,
    val startedAt: String,
    val completedAt: String?
)

@Serializable
data class ImportRunDetailDto(
    val id: String,
    val datasetKey: String,
    val datasetName: String,
    val sourceName: String,
    val referencePeriod: String?,
    val mode: String,
    val status: String,
    val fileName: String,
    val acceptedCount: Int,
    val rejectedCount: Int,
    val startedAt: String,
    val completedAt: String?,
    val sourceUrl: String?,
    val licenseUseCondition: String?,
    val spatialGranularity: String?,
    val temporalGranularity: String?,
    val checksumPrefix: String,
    val rejectionCodeCounts: Map<String, Int>,
    val safeMetadata: JsonElement?
)

data class ImportRunFilter(
    val datasetKey: String? = null,
    val mode: String? = null,
    val status: String? = null
)
