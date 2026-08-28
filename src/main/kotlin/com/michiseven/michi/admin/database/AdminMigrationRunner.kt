package com.michiseven.michi.admin.database

import com.michiseven.michi.admin.config.DatabaseConfig
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.output.MigrateResult
import org.slf4j.LoggerFactory

object AdminMigrationRunner {
    private val logger = LoggerFactory.getLogger(AdminMigrationRunner::class.java)

    fun migrate(config: DatabaseConfig): MigrateResult {
        require(!config.readOnly) { "Admin migrations require a writable admin database config." }

        logger.info("Applying admin schema migrations to database: {}", config.databaseName)
        return Flyway.configure()
            .dataSource(config.safeJdbcUrl(), config.username, config.password)
            .defaultSchema("admin")
            .schemas("admin")
            .createSchemas(true)
            .locations("classpath:db/migration/admin")
            .load()
            .migrate()
    }
}
