package com.michiseven.michi.admin.config

data class AppConfig(
    val appEnv: String,
    val host: String,
    val port: Int,
    val apiPrefix: String,
    val database: DatabaseConfig,
    val michiPublicApiUrl: String,
    val adminCorsOrigin: String,
    val adminAuthMode: String
) {
    val isProduction: Boolean get() = appEnv.equals("production", ignoreCase = true)

    companion object {
        fun load(): AppConfig {
            val appEnv = System.getenv("APP_ENV")?.trim()?.ifEmpty { null } ?: "development"
            val host = System.getenv("HOST")?.trim()?.ifEmpty { null } ?: "127.0.0.1"
            val port = System.getenv("PORT")?.toIntOrNull() ?: 4100
            val apiPrefix = System.getenv("API_PREFIX")?.trim()?.ifEmpty { null } ?: "/api/admin"
            val michiPublicApiUrl = (System.getenv("MICHI_PUBLIC_API_URL")?.trim()?.ifEmpty { null }
                ?: "http://localhost:4000/api").removeSuffix("/")
            val adminCorsOrigin = System.getenv("ADMIN_CORS_ORIGIN")?.trim()?.ifEmpty { null }
                ?: "http://localhost:3100"
            val adminAuthMode = System.getenv("ADMIN_AUTH_MODE")?.trim()?.ifEmpty { null } ?: "disabled"

            val dbHost = System.getenv("POSTGRES_HOST")?.trim()?.ifEmpty { null } ?: "127.0.0.1"
            val dbPort = System.getenv("POSTGRES_PORT")?.toIntOrNull() ?: 55432
            val dbName = System.getenv("POSTGRES_DB")?.trim()?.ifEmpty { null } ?: "michi"
            val dbUser = System.getenv("POSTGRES_USER")?.trim()?.ifEmpty { null } ?: "michi"
            val dbPassword = System.getenv("POSTGRES_PASSWORD")?.trim()?.ifEmpty { null } ?: "michi"
            val dbSsl = System.getenv("DATABASE_SSL")?.toBooleanStrictOrNull() ?: false

            val config = AppConfig(
                appEnv = appEnv,
                host = host,
                port = port,
                apiPrefix = if (apiPrefix.startsWith("/")) apiPrefix else "/$apiPrefix",
                database = DatabaseConfig(
                    host = dbHost,
                    port = dbPort,
                    databaseName = dbName,
                    username = dbUser,
                    password = dbPassword,
                    ssl = dbSsl
                ),
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
