package com.michiseven.michi.admin.auth

import com.michiseven.michi.admin.config.AppConfig
import com.michiseven.michi.admin.database.AdminMigrationRunner
import com.michiseven.michi.admin.database.DatabaseFactory
import com.zaxxer.hikari.HikariDataSource

fun main() {
    val config = AppConfig.load()
    val email = requireNotNull(config.adminBootstrapEmail) {
        "ADMIN_BOOTSTRAP_EMAIL is required."
    }.trim().lowercase()
    val displayName = requireNotNull(config.adminBootstrapDisplayName) {
        "ADMIN_BOOTSTRAP_DISPLAY_NAME is required."
    }.trim()
    val password = requireNotNull(config.adminBootstrapPassword) {
        "ADMIN_BOOTSTRAP_PASSWORD is required."
    }

    require(email.contains('@') && email.length <= 320) { "ADMIN_BOOTSTRAP_EMAIL is invalid." }
    require(displayName.isNotBlank() && displayName.length <= 100) {
        "ADMIN_BOOTSTRAP_DISPLAY_NAME must be between 1 and 100 characters."
    }
    require(password.length >= 12) { "ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters." }

    AdminMigrationRunner.migrate(config.adminDatabase)
    val dataSource = DatabaseFactory.createAdminDataSource(config.adminDatabase)
    try {
        val created = AuthRepository(dataSource).bootstrapOwner(
            email = email,
            displayName = displayName,
            passwordHash = PasswordHasher().hash(password.toCharArray())
        )
        println(if (created) "Admin owner bootstrap completed." else "Admin owner bootstrap skipped.")
    } finally {
        (dataSource as? HikariDataSource)?.close()
    }
}
