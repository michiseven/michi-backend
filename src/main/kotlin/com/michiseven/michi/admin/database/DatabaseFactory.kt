package com.michiseven.michi.admin.database

import com.michiseven.michi.admin.config.DatabaseConfig
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.slf4j.LoggerFactory
import java.sql.Connection
import javax.sql.DataSource

object DatabaseFactory {
    private val logger = LoggerFactory.getLogger(DatabaseFactory::class.java)

    fun createDataSource(config: DatabaseConfig): DataSource {
        val hikariConfig = HikariConfig().apply {
            jdbcUrl = config.safeJdbcUrl()
            username = config.username
            password = config.password
            maximumPoolSize = config.maximumPoolSize
            minimumIdle = config.minimumIdle
            connectionTimeout = config.connectionTimeoutMs
            isReadOnly = true
            poolName = "MichiAdminHikariPool"

            // Strictly enforce read-only transaction defaults
            connectionInitSql = "SET default_transaction_read_only = on"

            addDataSourceProperty("cachePrepStmts", "true")
            addDataSourceProperty("prepStmtCacheSize", "250")
            addDataSourceProperty("prepStmtCacheSqlLimit", "2048")
        }

        logger.info("Initializing read-only database pool for database: {}", config.databaseName)
        return HikariDataSource(hikariConfig)
    }
}

fun <T> DataSource.withReadOnlyConnection(block: (Connection) -> T): T {
    return connection.use { conn ->
        val originalReadOnly = conn.isReadOnly
        val originalAutoCommit = conn.autoCommit
        try {
            conn.isReadOnly = true
            block(conn)
        } finally {
            try {
                conn.isReadOnly = originalReadOnly
                conn.autoCommit = originalAutoCommit
            } catch (_: Exception) {
            }
        }
    }
}
