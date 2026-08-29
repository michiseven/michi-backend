package com.michiseven.michi.admin

import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.dashboard.DashboardRepository
import com.michiseven.michi.admin.database.DatabaseHealthRepository
import com.michiseven.michi.admin.evaluations.EvaluationFilter
import com.michiseven.michi.admin.evaluations.EvaluationRepository
import com.michiseven.michi.admin.imports.ImportRepository
import com.michiseven.michi.admin.imports.ImportRunFilter
import com.michiseven.michi.admin.places.PlaceFilter
import com.michiseven.michi.admin.places.PlaceRepository
import com.michiseven.michi.admin.places.PlaceSources
import com.michiseven.michi.admin.sync.SyncRepository
import com.zaxxer.hikari.HikariConfig
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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DatabaseIntegrationTest {

    private val postgisImage = DockerImageName.parse("postgis/postgis:16-3.4-alpine")
        .asCompatibleSubstituteFor("postgres")

    private val postgres = PostgreSQLContainer(postgisImage)
        .withDatabaseName("michi_test")
        .withUsername("michi")
        .withPassword("michi")

    private lateinit var adminDataSource: DataSource
    private lateinit var setupDataSource: DataSource

    @BeforeAll
    fun setup() {
        val dockerAvailable = try {
            DockerClientFactory.instance().isDockerAvailable
        } catch (_: Throwable) {
            false
        }

        assumeTrue(dockerAvailable, "Docker environment is not available for Testcontainers")

        // Start container - if Docker was reported available but start fails, this will throw and FAIL the test
        postgres.start()

        // Setup datasource with write permissions for test schema creation & fixture insertion
        val setupConfig = HikariConfig().apply {
            jdbcUrl = postgres.jdbcUrl
            username = postgres.username
            password = postgres.password
            isReadOnly = false
        }
        setupDataSource = HikariDataSource(setupConfig)

        // Read schema and initialize test tables
        val schemaSql = object {}.javaClass.getResourceAsStream("/test-schema.sql")
            ?.bufferedReader()?.use { it.readText() }
            ?: throw IllegalStateException("test-schema.sql not found in test resources")

        setupDataSource.connection.use { conn ->
            conn.createStatement().use { stmt ->
                stmt.execute(schemaSql)

                // Insert fixtures using actual source names (kto-tour-jpn, naver-local, and an unknown source)
                stmt.execute("""
                    INSERT INTO places (id, source, source_place_id, name, category, address, road_address, location, raw_payload)
                    VALUES 
                    ('11111111-1111-1111-1111-111111111111', '${PlaceSources.KTO}', 'kto-101', 'Gyeongbokgung Palace', '관광지', 'Seoul Jongno-gu Sejongno', 'Sajik-ro 161', ST_SetSRID(ST_MakePoint(126.9769, 37.5796), 4326)::geography, '{"source": "${PlaceSources.KTO}"}'::jsonb),
                    ('22222222-2222-2222-2222-222222222222', '${PlaceSources.NAVER}', 'nav-202', 'Bukchon Hanok Village', '관광지', 'Seoul Jongno-gu Gahoe-dong', 'Bukchon-ro', NULL, '{"source": "${PlaceSources.NAVER}"}'::jsonb),
                    ('33333333-3333-3333-3333-333333333334', 'custom-unregistered', 'cust-303', 'Unknown Vendor Place', '기타', 'Seoul', 'Seoul', NULL, '{"source": "custom"}'::jsonb);

                    INSERT INTO tourism_data_sources (id, dataset_key, name, source_name, url, spatial_granularity, temporal_granularity)
                    VALUES ('33333333-3333-3333-3333-333333333333', 'kto-datalab-concentration', '한국관광 데이터랩 집중도', '한국관광공사', 'https://datalab.visitkorea.or.kr', 'district', 'monthly');

                    INSERT INTO tourism_import_runs (id, source_id, file_name, file_sha256, reference_period, mode, status, accepted_count, rejected_count, started_at, completed_at)
                    VALUES ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'datalab_202607.csv', 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', '2026-07', 'live', 'completed', 100, 2, NOW() - INTERVAL '1 hour', NOW());

                    INSERT INTO tourism_metrics (id, source_id, import_run_id, place_id, metric_type, value, unit, period_start, period_end, dimension_key)
                    VALUES ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'tourism_concentration', 0.65, 'ratio', '2026-07-01', '2026-07-31', 'dimkey123456789012345678901234567890123456789012345678901234567890');

                    INSERT INTO recommendation_evaluations (id, scenario_key, preference_snapshot, candidate_snapshot, data_mode, baseline_algorithm_version, michi_algorithm_version, baseline_metrics, michi_metrics, delta)
                    VALUES ('66666666-6666-6666-6666-666666666666', 'sc-1', '{"area": "Jongno-gu", "travelDate": "2026-08-22"}'::jsonb, '[{"placeId": "kto-101", "source": "${PlaceSources.KTO}", "tourismConcentration": 0.65}]'::jsonb, 'live', 'baseline-v1', 'michi-v1', '{"tourismConcentrationScore": 0.75, "nonHotspotInclusionRate": 0.1}'::jsonb, '{"tourismConcentrationScore": 0.45, "nonHotspotInclusionRate": 0.5}'::jsonb, '{"concentrationReduction": 0.3}'::jsonb);
                """.trimIndent())
            }
        }

        // Initialize admin read-only connection pool
        val adminConfig = HikariConfig().apply {
            jdbcUrl = postgres.jdbcUrl
            username = postgres.username
            password = postgres.password
            isReadOnly = true
            connectionInitSql = "SET default_transaction_read_only = on"
        }
        adminDataSource = HikariDataSource(adminConfig)
    }

    @AfterAll
    fun teardown() {
        if (this::adminDataSource.isInitialized) {
            (adminDataSource as? HikariDataSource)?.close()
        }
        if (this::setupDataSource.isInitialized) {
            (setupDataSource as? HikariDataSource)?.close()
        }
        if (postgres.isRunning) {
            postgres.stop()
        }
    }

    @Test
    fun `read-only connection blocks INSERT and schema modification`() {
        adminDataSource.connection.use { conn ->
            val writeStmt = conn.createStatement()
            try {
                writeStmt.executeUpdate("INSERT INTO places (source, source_place_id, name) VALUES ('test', 't1', 'Illegal Write')")
                assertTrue(false, "Expected SQLException on write operation in read-only transaction")
            } catch (e: SQLException) {
                // Expected: read-only transaction error
                assertTrue(e.message?.contains("read-only", ignoreCase = true) == true || e.sqlState == "25006")
            }
        }
    }

    @Test
    fun `queries places, evaluations, and summary successfully with correct source counts`() {
        val healthRepo = DatabaseHealthRepository(adminDataSource)
        assertTrue(healthRepo.isDatabaseConnected())

        val dashboardRepo = DashboardRepository(adminDataSource)
        val summary = dashboardRepo.getSummary()
        assertEquals(3, summary.places.total)
        assertEquals(2, summary.places.withoutLocation)
        assertEquals(1, summary.places.kto)
        assertEquals(1, summary.places.naver)
        assertEquals(1, summary.tourismMetrics.total)
        assertEquals(1, summary.tourismMetrics.linkedPlaces)

        val placeRepo = PlaceRepository(adminDataSource)
        val places = placeRepo.findPlaces(PlaceFilter(), PageRequest.of(1, 10, null, null, PlaceRepository.ALLOWED_SORTS.keys))
        assertEquals(3, places.totalItems)
        val detail = placeRepo.findPlaceById("11111111-1111-1111-1111-111111111111")
        assertNotNull(detail.latitude)
        assertNotNull(detail.longitude)
        assertEquals(37.5796, detail.latitude!!, 0.001)
        assertEquals(126.9769, detail.longitude!!, 0.001)

        val importRepo = ImportRepository(adminDataSource)
        val imports = importRepo.findImportRuns(ImportRunFilter(), PageRequest.of(1, 10, null, null, ImportRepository.ALLOWED_SORTS.keys))
        assertEquals(1, imports.totalItems)
        val importDetail = importRepo.findImportRunById("44444444-4444-4444-4444-444444444444")
        assertEquals("abcdef123456", importDetail.checksumPrefix)

        val evalRepo = EvaluationRepository(adminDataSource)
        val evals = evalRepo.findEvaluations(EvaluationFilter(), PageRequest.of(1, 10, null, null, EvaluationRepository.ALLOWED_SORTS.keys))
        assertEquals(1, evals.totalItems)
        val evalDetail = evalRepo.findEvaluationById("66666666-6666-6666-6666-666666666666")
        assertEquals("available", evalDetail.expectedEffect.evidenceStatus)
        assertEquals(0.3, evalDetail.expectedEffect.concentrationReduction)

        val syncRepo = SyncRepository(adminDataSource)
        val jobs = syncRepo.getSyncJobs()
        assertEquals(2, jobs.size)
        val ktoJob = jobs.find { it.key == "kto-seoul-poi" }
        assertEquals("unavailable", ktoJob?.historyStatus)
    }
}
