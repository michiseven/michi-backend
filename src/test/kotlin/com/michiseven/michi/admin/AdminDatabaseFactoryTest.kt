package com.michiseven.michi.admin

import com.michiseven.michi.admin.config.DatabaseConfig
import com.michiseven.michi.admin.database.AdminMigrationRunner
import com.michiseven.michi.admin.database.DatabaseFactory
import org.junit.jupiter.api.Test
import kotlin.test.assertFailsWith

class AdminDatabaseFactoryTest {
    private val readOnlyConfig = DatabaseConfig(
        host = "localhost",
        port = 5432,
        databaseName = "michi",
        username = "reader",
        password = "test-only",
        ssl = false,
        readOnly = true
    )

    @Test
    fun `admin datasource rejects read-only configuration`() {
        assertFailsWith<IllegalArgumentException> {
            DatabaseFactory.createAdminDataSource(readOnlyConfig)
        }
    }

    @Test
    fun `admin migration rejects read-only configuration`() {
        assertFailsWith<IllegalArgumentException> {
            AdminMigrationRunner.migrate(readOnlyConfig)
        }
    }
}
