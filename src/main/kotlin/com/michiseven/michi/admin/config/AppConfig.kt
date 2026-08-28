package com.michiseven.michi.admin.config

import java.io.File

data class AppConfig(
    val appEnv: String,
    val host: String,
    val port: Int,
    val apiPrefix: String,
    val database: DatabaseConfig,
    val adminDatabase: DatabaseConfig = database.copy(
        readOnly = false,
        maximumPoolSize = 5,
        minimumIdle = 1
    ),
    val adminMigrationsEnabled: Boolean = false,
    val adminSessionTtlHours: Long = 12,
    val adminBootstrapEmail: String? = null,
    val adminBootstrapDisplayName: String? = null,
    val adminBootstrapPassword: String? = null,
    val michiPublicApiUrl: String,
    val adminCorsOrigin: String,
    val adminAuthMode: String
) {
    val isProduction: Boolean get() = appEnv.equals("production", ignoreCase = true)

    companion object {
        private fun loadDotEnv(): Map<String, String> {
            val envMap = mutableMapOf<String, String>()
            val candidatePaths = listOf(
                File(".env"),
                File("../backend/.env"),
                File("../.env"),
                File("../../backend/.env"),
                File("backend/.env")
            )
            for (file in candidatePaths) {
                if (file.exists() && file.isFile) {
                    try {
                        file.forEachLine { line ->
                            val trimmed = line.trim()
                            if (trimmed.isNotEmpty() && !trimmed.startsWith("#") && trimmed.contains("=")) {
                                val idx = trimmed.indexOf("=")
                                val key = trimmed.substring(0, idx).trim()
                                var value = trimmed.substring(idx + 1).trim()
                                if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
                                    value = value.substring(1, value.length - 1)
                                }
                                if (!envMap.containsKey(key)) {
                                    envMap[key] = value
                                }
                            }
                        }
                    } catch (_: Exception) {
                        // ignore file read issues
                    }
                }
            }
            return envMap
        }

        fun load(): AppConfig {
            val dotEnv = loadDotEnv()
            fun getVal(key: String): String? {
                return System.getenv(key)?.trim()?.ifEmpty { null }
                    ?: dotEnv[key]?.trim()?.ifEmpty { null }
            }

            val appEnv = getVal("APP_ENV") ?: "development"
            val host = getVal("ADMIN_HOST")
                ?: getVal("HOST")
                ?: "127.0.0.1"
            val port = getVal("ADMIN_PORT")?.toIntOrNull()
                ?: 4100
            val rawPrefix = getVal("ADMIN_API_PREFIX")
                ?: "/api/admin"
            val apiPrefix = if (rawPrefix.startsWith("/")) rawPrefix else "/$rawPrefix"

            val michiPublicApiUrl = (getVal("MICHI_PUBLIC_API_URL")
                ?: "http://localhost:4000/api").removeSuffix("/")
            val adminCorsOrigin = getVal("ADMIN_CORS_ORIGIN")
                ?: "http://localhost:3100"
            val adminAuthMode = getVal("ADMIN_AUTH_MODE") ?: "disabled"

            val dbHost = getVal("POSTGRES_HOST") ?: "127.0.0.1"
            val dbPort = getVal("POSTGRES_PORT")?.toIntOrNull() ?: 5432
            val dbName = getVal("POSTGRES_DB") ?: "michi"
            val dbUser = getVal("POSTGRES_USER") ?: "postgres"
            val dbPassword = getVal("POSTGRES_PASSWORD") ?: ""
            val dbSsl = getVal("DATABASE_SSL")?.toBooleanStrictOrNull() ?: false

            val adminDbHost = getVal("ADMIN_POSTGRES_HOST") ?: dbHost
            val adminDbPort = getVal("ADMIN_POSTGRES_PORT")?.toIntOrNull() ?: dbPort
            val adminDbName = getVal("ADMIN_POSTGRES_DB") ?: dbName
            val adminDbUser = getVal("ADMIN_POSTGRES_USER") ?: dbUser
            val adminDbPassword = getVal("ADMIN_POSTGRES_PASSWORD") ?: dbPassword
            val adminDbSsl = getVal("ADMIN_DATABASE_SSL")?.toBooleanStrictOrNull() ?: dbSsl
            val adminMigrationsEnabled = getVal("ADMIN_MIGRATIONS_ENABLED")
                ?.toBooleanStrictOrNull() ?: false
            val adminSessionTtlHours = getVal("ADMIN_SESSION_TTL_HOURS")?.toLongOrNull() ?: 12

            val config = AppConfig(
                appEnv = appEnv,
                host = host,
                port = port,
                apiPrefix = apiPrefix,
                database = DatabaseConfig(
                    host = dbHost,
                    port = dbPort,
                    databaseName = dbName,
                    username = dbUser,
                    password = dbPassword,
                    ssl = dbSsl
                ),
                adminDatabase = DatabaseConfig(
                    host = adminDbHost,
                    port = adminDbPort,
                    databaseName = adminDbName,
                    username = adminDbUser,
                    password = adminDbPassword,
                    ssl = adminDbSsl,
                    maximumPoolSize = 5,
                    minimumIdle = 1,
                    readOnly = false
                ),
                adminMigrationsEnabled = adminMigrationsEnabled,
                adminSessionTtlHours = adminSessionTtlHours,
                adminBootstrapEmail = getVal("ADMIN_BOOTSTRAP_EMAIL"),
                adminBootstrapDisplayName = getVal("ADMIN_BOOTSTRAP_DISPLAY_NAME"),
                adminBootstrapPassword = getVal("ADMIN_BOOTSTRAP_PASSWORD"),
                michiPublicApiUrl = michiPublicApiUrl,
                adminCorsOrigin = adminCorsOrigin,
                adminAuthMode = adminAuthMode
            )

            EnvironmentValidator.validate(config)
            return config
        }
    }
}

data class DatabaseConfig(
    val host: String,
    val port: Int,
    val databaseName: String,
    val username: String,
    val password: String,
    val ssl: Boolean,
    val maximumPoolSize: Int = 10,
    val minimumIdle: Int = 2,
    val connectionTimeoutMs: Long = 10000,
    val readOnly: Boolean = true
) {
    fun safeJdbcUrl(): String {
        val sslParam = if (ssl) "?ssl=true&sslmode=require" else ""
        return "jdbc:postgresql://$host:$port/$databaseName$sslParam"
    }
}
