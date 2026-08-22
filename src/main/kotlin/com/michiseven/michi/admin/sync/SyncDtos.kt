package com.michiseven.michi.admin.sync

import kotlinx.serialization.Serializable

@Serializable
data class SyncJobDto(
    val key: String,
    val name: String,
    val description: String,
    val schedule: String,
    val historyStatus: String, // available | partial | unavailable
    val lastRunAt: String?,
    val lastStatus: String?,
    val mutationEnabled: Boolean = false,
    val mutationDisabledReason: String = "관리자 인증·권한·감사 로그가 아직 구현되지 않음"
)

@Serializable
data class SyncRunDto(
    val id: String,
    val jobKey: String,
    val startedAt: String,
    val completedAt: String?,
    val status: String,
    val message: String?
)
