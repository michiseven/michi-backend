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

class UnauthorizedException(
    message: String = "관리자 로그인이 필요합니다.",
    code: String = "ADMIN_UNAUTHORIZED"
) : AdminApiException(code, message, 401)

class ForbiddenException(
    message: String = "해당 작업을 수행할 권한이 없습니다.",
    code: String = "ADMIN_FORBIDDEN"
) : AdminApiException(code, message, 403)

class ConflictException(
    message: String = "이미 존재하는 리소스이거나 충돌이 발생했습니다.",
    code: String = "ADMIN_CONFLICT"
) : AdminApiException(code, message, 409)

class TooManyRequestsException(
    message: String = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    code: String = "ADMIN_LOGIN_RATE_LIMITED"
) : AdminApiException(code, message, 429)
