package com.michiseven.michi.admin.database

import com.michiseven.michi.admin.config.AppConfig

fun main() {
    val config = AppConfig.load()
    val result = AdminMigrationRunner.migrate(config.adminDatabase)
    println(
        "Admin schema migration completed: " +
            "executed=${result.migrationsExecuted}, version=${result.targetSchemaVersion ?: "none"}"
    )
}
