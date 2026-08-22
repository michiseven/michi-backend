package com.michiseven.michi.admin.common

import io.ktor.server.application.ApplicationCall
import io.ktor.util.AttributeKey
import java.util.UUID

val RequestIdAttributeKey = AttributeKey<String>("AdminRequestId")

fun ApplicationCall.requestId(): String {
    return attributes.computeIfAbsent(RequestIdAttributeKey) {
        request.headers["X-Request-Id"] ?: UUID.randomUUID().toString()
    }
}
