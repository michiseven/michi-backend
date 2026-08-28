package com.michiseven.michi.admin

import com.michiseven.michi.admin.places.PlaceRepository
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Test
import java.io.PrintWriter
import java.sql.Connection
import java.util.logging.Logger
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class PlaceMetadataSanitizationTest {
    private val unusedDataSource = object : DataSource {
        override fun getConnection(): Connection = error("unused")
        override fun getConnection(username: String?, password: String?): Connection = error("unused")
        override fun getLogWriter(): PrintWriter? = null
        override fun setLogWriter(out: PrintWriter?) = Unit
        override fun setLoginTimeout(seconds: Int) = Unit
        override fun getLoginTimeout(): Int = 0
        override fun getParentLogger(): Logger = Logger.getGlobal()
        override fun <T : Any?> unwrap(iface: Class<T>?): T = error("unused")
        override fun isWrapperFor(iface: Class<*>?): Boolean = false
    }

    @Test
    fun `removes sensitive keys recursively while preserving operational metadata`() {
        val input = Json.parseToJsonElement(
            """{"name":"카페","apiKey":"secret","nested":{"token":"hidden","category":"cafe"}}"""
        )
        val sanitized = PlaceRepository(unusedDataSource).sanitizeMetadata(input)!!.jsonObject

        assertEquals("\"카페\"", sanitized["name"].toString())
        assertFalse("apiKey" in sanitized)
        val nested = sanitized.getValue("nested").jsonObject
        assertFalse("token" in nested)
        assertEquals("\"cafe\"", nested["category"].toString())
    }
}
