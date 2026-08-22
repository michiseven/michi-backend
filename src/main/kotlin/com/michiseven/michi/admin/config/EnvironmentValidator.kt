package com.michiseven.michi.admin.config

object EnvironmentValidator {
    fun validate(config: AppConfig) {
        if (config.isProduction && config.adminAuthMode.equals("disabled", ignoreCase = true)) {
            throw IllegalStateException(
                "CRITICAL_SECURITY_ERROR: Production environment cannot start with ADMIN_AUTH_MODE=disabled. " +
                "Production deployment is disabled until admin authentication, sessions, and audit logging are implemented."
            )
        }
    }
}
