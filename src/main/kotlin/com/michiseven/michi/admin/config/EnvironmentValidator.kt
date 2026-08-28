package com.michiseven.michi.admin.config

object EnvironmentValidator {
    fun validate(config: AppConfig) {
        require(config.adminAuthMode in setOf("disabled", "session")) {
            "ADMIN_AUTH_MODE must be either disabled or session."
        }
        require(config.adminSessionTtlHours in 1..168) {
            "ADMIN_SESSION_TTL_HOURS must be between 1 and 168."
        }
        if (config.isProduction && config.adminAuthMode.equals("disabled", ignoreCase = true)) {
            throw IllegalStateException(
                "CRITICAL_SECURITY_ERROR: Production environment cannot start with ADMIN_AUTH_MODE=disabled. " +
                "Production deployment is disabled until admin authentication, sessions, and audit logging are implemented."
            )
        }
    }
}
