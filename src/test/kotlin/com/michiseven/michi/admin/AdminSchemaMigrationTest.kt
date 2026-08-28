package com.michiseven.michi.admin

import com.michiseven.michi.admin.config.DatabaseConfig
import com.michiseven.michi.admin.database.AdminMigrationRunner
import com.michiseven.michi.admin.database.DatabaseFactory
import com.zaxxer.hikari.HikariDataSource
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.testcontainers.DockerClientFactory
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName
import java.sql.SQLException
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AdminSchemaMigrationTest {
    private val postgres = PostgreSQLContainer(
        DockerImageName.parse("postgres:16-alpine")
    ).withDatabaseName("michi_admin_test")
        .withUsername("michi_admin")
        .withPassword("michi_admin")

    private lateinit var dataSource: DataSource
    private lateinit var databaseConfig: DatabaseConfig

    @BeforeAll
    fun setup() {
        val dockerAvailable = try {
            DockerClientFactory.instance().isDockerAvailable
        } catch (_: Throwable) {
            false
        }
        assumeTrue(dockerAvailable, "Docker environment is not available for Testcontainers")

        postgres.start()
        databaseConfig = DatabaseConfig(
            host = postgres.host,
            port = postgres.getMappedPort(5432),
            databaseName = postgres.databaseName,
            username = postgres.username,
            password = postgres.password,
            ssl = false,
            maximumPoolSize = 2,
            minimumIdle = 1,
            readOnly = false
        )

        AdminMigrationRunner.migrate(databaseConfig)
        dataSource = DatabaseFactory.createAdminDataSource(databaseConfig)
    }

    @AfterAll
    fun teardown() {
        if (this::dataSource.isInitialized) {
            (dataSource as? HikariDataSource)?.close()
        }
        if (postgres.isRunning) {
            postgres.stop()
        }
    }

    @Test
    fun `migration creates identity tables and is idempotent`() {
        dataSource.connection.use { connection ->
            val tableNames = connection.prepareStatement(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'admin'
                  AND table_name IN ('admin_users', 'admin_sessions', 'admin_audit_logs')
                ORDER BY table_name
                """.trimIndent()
            ).use { statement ->
                statement.executeQuery().use { resultSet ->
                    buildList {
                        while (resultSet.next()) add(resultSet.getString("table_name"))
                    }
                }
            }

            assertEquals(
                listOf("admin_audit_logs", "admin_sessions", "admin_users"),
                tableNames
            )
        }

        val secondMigration = AdminMigrationRunner.migrate(databaseConfig)
        assertEquals(0, secondMigration.migrationsExecuted)
    }

    @Test
    fun `email uniqueness and role constraints are enforced`() {
        dataSource.connection.use { connection ->
            connection.prepareStatement(
                "INSERT INTO admin.admin_users (email, display_name) VALUES (?, ?)"
            ).use { statement ->
                statement.setString(1, "owner@michi.local")
                statement.setString(2, "Michi Owner")
                assertEquals(1, statement.executeUpdate())
            }
        }

        assertFailsWith<SQLException> {
            dataSource.connection.use { connection ->
                connection.prepareStatement(
                    "INSERT INTO admin.admin_users (email, display_name) VALUES (?, ?)"
                ).use { statement ->
                    statement.setString(1, "OWNER@michi.local")
                    statement.setString(2, "Duplicate Owner")
                    statement.executeUpdate()
                }
            }
        }

        assertFailsWith<SQLException> {
            dataSource.connection.use { connection ->
                connection.prepareStatement(
                    "INSERT INTO admin.admin_users (email, display_name, role) VALUES (?, ?, ?)"
                ).use { statement ->
                    statement.setString(1, "invalid-role@michi.local")
                    statement.setString(2, "Invalid Role")
                    statement.setString(3, "superuser")
                    statement.executeUpdate()
                }
            }
        }
    }

    @Test
    fun `deleting a user removes sessions and preserves audit history`() {
        val userId = dataSource.connection.use { connection ->
            connection.prepareStatement(
                """
                INSERT INTO admin.admin_users (
                    email, display_name, password_hash, role, status
                ) VALUES (?, ?, ?, 'admin', 'active')
                RETURNING id
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, "admin@michi.local")
                statement.setString(2, "Michi Admin")
                statement.setString(3, "test-password-hash")
                statement.executeQuery().use { resultSet ->
                    assertTrue(resultSet.next())
                    resultSet.getObject("id")
                }
            }
        }

        dataSource.connection.use { connection ->
            connection.prepareStatement(
                """
                INSERT INTO admin.admin_sessions (
                    admin_user_id, session_token_hash, expires_at
                ) VALUES (?::uuid, ?, NOW() + INTERVAL '1 day')
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, userId)
                statement.setString(2, "test-refresh-token-hash")
                statement.executeUpdate()
            }

            connection.prepareStatement(
                """
                INSERT INTO admin.admin_audit_logs (
                    admin_user_id, action, resource_type, result
                ) VALUES (?::uuid, 'admin_user.deleted', 'admin_user', 'success')
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, userId)
                statement.executeUpdate()
            }

            connection.prepareStatement(
                "DELETE FROM admin.admin_users WHERE id = ?::uuid"
            ).use { statement ->
                statement.setObject(1, userId)
                statement.executeUpdate()
            }
        }

        dataSource.connection.use { connection ->
            val sessionCount = connection.createStatement().use { statement ->
                statement.executeQuery("SELECT COUNT(*) FROM admin.admin_sessions").use { resultSet ->
                    resultSet.next()
                    resultSet.getLong(1)
                }
            }
            val auditUserIsNull = connection.createStatement().use { statement ->
                statement.executeQuery(
                    "SELECT admin_user_id IS NULL FROM admin.admin_audit_logs LIMIT 1"
                ).use { resultSet ->
                    resultSet.next()
                    resultSet.getBoolean(1)
                }
            }

            assertEquals(0, sessionCount)
            assertTrue(auditUserIsNull)
        }
    }
}
