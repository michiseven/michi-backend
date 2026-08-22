package com.michiseven.michi.admin.database

import org.slf4j.LoggerFactory
import javax.sql.DataSource

class DatabaseHealthRepository(private val dataSource: DataSource) {
    private val logger = LoggerFactory.getLogger(DatabaseHealthRepository::class.java)

    fun isDatabaseConnected(): Boolean {
        return try {
            dataSource.withReadOnlyConnection { conn ->
                conn.createStatement().use { stmt ->
                    stmt.executeQuery("SELECT 1").use { rs ->
                        rs.next() && rs.getInt(1) == 1
                    }
                }
            }
        } catch (e: Exception) {
            logger.warn("Database health check failed: {}", e.message)
            false
        }
    }
}
