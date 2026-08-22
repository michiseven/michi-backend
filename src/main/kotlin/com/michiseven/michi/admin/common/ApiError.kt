package com.michiseven.michi.admin.common

import kotlinx.serialization.Serializable

@Serializable
data class ApiErrorResponse(
    val code: String,
    val message: String,
    val requestId: String
)

open class AdminApiException(
    val code: String,
    override val message: String,
    val statusCode: Int = 400
) : RuntimeException(message)

class ResourceNotFoundException(
    code: String = "ADMIN_RESOURCE_NOT_FOUND",
    message: String = "요청한 리소스를 찾을 수 없습니다."
) : AdminApiException(code, message, 404)

class InvalidQueryException(
    message: String,
    code: String = "ADMIN_INVALID_QUERY"
) : AdminApiException(code, message, 400)
