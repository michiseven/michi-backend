package com.michiseven.michi.admin

import com.michiseven.michi.admin.common.AdminApiException
import com.michiseven.michi.admin.common.ApiErrorResponse
import com.michiseven.michi.admin.common.InvalidQueryException
import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.ResourceNotFoundException
import com.michiseven.michi.admin.common.requestId
import com.michiseven.michi.admin.config.AppConfig
import com.michiseven.michi.admin.dashboard.DashboardRepository
import com.michiseven.michi.admin.database.DatabaseFactory
import com.michiseven.michi.admin.database.DatabaseHealthRepository
import com.michiseven.michi.admin.evaluations.EvaluationFilter
import com.michiseven.michi.admin.evaluations.EvaluationRepository
import com.michiseven.michi.admin.health.HealthService
import com.michiseven.michi.admin.imports.ImportRepository
import com.michiseven.michi.admin.imports.ImportRunFilter
import com.michiseven.michi.admin.places.PlaceFilter
import com.michiseven.michi.admin.places.PlaceRepository
import com.michiseven.michi.admin.providers.ProviderService
import com.michiseven.michi.admin.sync.SyncRepository
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import javax.sql.DataSource

fun main() {
    val config = AppConfig.load()
    val dataSource = DatabaseFactory.createDataSource(config.database)

    embeddedServer(Netty, port = config.port, host = config.host) {
        module(config, dataSource)
    }.start(wait = true)
}

fun Application.module(
    config: AppConfig,
    dataSource: DataSource,
    healthServiceOverride: HealthService? = null,
    providerServiceOverride: ProviderService? = null
) {
    val logger = LoggerFactory.getLogger("MichiAdminApp")

    val dbHealthRepo = DatabaseHealthRepository(dataSource)
    val healthService = healthServiceOverride ?: HealthService(dbHealthRepo, config)
    val dashboardRepo = DashboardRepository(dataSource)
    val placeRepo = PlaceRepository(dataSource)
    val importRepo = ImportRepository(dataSource)
    val evalRepo = EvaluationRepository(dataSource)
    val syncRepo = SyncRepository(dataSource)
    val providerService = providerServiceOverride ?: ProviderService(config)

    install(CallLogging)

    install(CORS) {
        allowMethod(HttpMethod.Options)
        allowMethod(HttpMethod.Get)
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
        allowHeader(HttpHeaders.Accept)
        allowHeader("X-Request-Id")

        val origins = config.adminCorsOrigin.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        origins.forEach { origin ->
            if (origin.startsWith("http://") || origin.startsWith("https://")) {
                val hostPort = origin.substringAfter("://")
                val schemes = listOf(origin.substringBefore("://"))
                allowHost(hostPort, schemes = schemes)
            } else {
                allowHost(origin)
            }
        }
    }

    install(ContentNegotiation) {
        json(Json {
            prettyPrint = true
            isLenient = true
            ignoreUnknownKeys = true
            encodeDefaults = true
        })
    }

    install(StatusPages) {
        exception<AdminApiException> { call, cause ->
            val reqId = call.requestId()
            logger.warn("AdminApiException [{}]: {} - {}", reqId, cause.code, cause.message)
            call.respond(
                HttpStatusCode.fromValue(cause.statusCode),
                ApiErrorResponse(code = cause.code, message = cause.message, requestId = reqId)
            )
        }

        exception<Throwable> { call, cause ->
            val reqId = call.requestId()
            logger.error("Unhandled exception [{}]", reqId, cause)
            // Never leak SQL, credentials or stack traces to client
            call.respond(
                HttpStatusCode.InternalServerError,
                ApiErrorResponse(
                    code = "ADMIN_INTERNAL_ERROR",
                    message = "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
                    requestId = reqId
                )
            )
        }
    }

    routing {
        route(config.apiPrefix) {
            adminRoutes(
                healthService,
                dashboardRepo,
                placeRepo,
                importRepo,
                evalRepo,
                syncRepo,
                providerService
            )
        }
    }
}

fun Route.adminRoutes(
    healthService: HealthService,
    dashboardRepo: DashboardRepository,
    placeRepo: PlaceRepository,
    importRepo: ImportRepository,
    evalRepo: EvaluationRepository,
    syncRepo: SyncRepository,
    providerService: ProviderService
) {
    // 1. Health
    get("/health") {
        val health = healthService.checkHealth()
        call.respond(health)
    }

    // 2. Summary
    get("/summary") {
        val summary = dashboardRepo.getSummary()
        call.respond(summary)
    }

    // 3. Places
    route("/places") {
        get {
            val page = call.request.queryParameters["page"]?.toIntOrNull()
            val pageSize = call.request.queryParameters["pageSize"]?.toIntOrNull()
            val sort = call.request.queryParameters["sort"]
            val direction = call.request.queryParameters["direction"]

            val pageRequest = PageRequest.of(
                page = page,
                pageSize = pageSize,
                sort = sort,
                direction = direction,
                allowedSorts = PlaceRepository.ALLOWED_SORTS.keys,
                defaultSort = "updatedAt"
            )

            val filter = PlaceFilter(
                query = call.request.queryParameters["query"],
                provider = call.request.queryParameters["provider"],
                category = call.request.queryParameters["category"],
                coordinateStatus = call.request.queryParameters["coordinateStatus"],
                tourismMetricStatus = call.request.queryParameters["tourismMetricStatus"]
            )

            val result = placeRepo.findPlaces(filter, pageRequest)
            call.respond(result)
        }

        get("/{id}") {
            val id = call.parameters["id"] ?: throw InvalidQueryException("장소 ID가 필요합니다.")
            val place = placeRepo.findPlaceById(id)
            call.respond(place)
        }
    }

    // 4. Import Runs
    route("/import-runs") {
        get {
            val page = call.request.queryParameters["page"]?.toIntOrNull()
            val pageSize = call.request.queryParameters["pageSize"]?.toIntOrNull()
            val sort = call.request.queryParameters["sort"]
            val direction = call.request.queryParameters["direction"]

            val pageRequest = PageRequest.of(
                page = page,
                pageSize = pageSize,
                sort = sort,
                direction = direction,
                allowedSorts = ImportRepository.ALLOWED_SORTS.keys,
                defaultSort = "startedAt"
            )

            val filter = ImportRunFilter(
                datasetKey = call.request.queryParameters["datasetKey"],
                mode = call.request.queryParameters["mode"],
                status = call.request.queryParameters["status"]
            )

            val result = importRepo.findImportRuns(filter, pageRequest)
            call.respond(result)
        }

        get("/{id}") {
            val id = call.parameters["id"] ?: throw InvalidQueryException("Import run ID가 필요합니다.")
            val detail = importRepo.findImportRunById(id)
            call.respond(detail)
        }
    }

    // 5. Evaluations
    route("/evaluations") {
        get {
            val page = call.request.queryParameters["page"]?.toIntOrNull()
            val pageSize = call.request.queryParameters["pageSize"]?.toIntOrNull()
            val sort = call.request.queryParameters["sort"]
            val direction = call.request.queryParameters["direction"]

            val pageRequest = PageRequest.of(
                page = page,
                pageSize = pageSize,
                sort = sort,
                direction = direction,
                allowedSorts = EvaluationRepository.ALLOWED_SORTS.keys,
                defaultSort = "createdAt"
            )

            val filter = EvaluationFilter(
                dataMode = call.request.queryParameters["dataMode"]
            )

            val result = evalRepo.findEvaluations(filter, pageRequest)
            call.respond(result)
        }

        get("/{id}") {
            val id = call.parameters["id"] ?: throw InvalidQueryException("평가 ID가 필요합니다.")
            val detail = evalRepo.findEvaluationById(id)
            call.respond(detail)
        }
    }

    // 6. Sync Jobs & Runs
    route("/sync-jobs") {
        get {
            val jobs = syncRepo.getSyncJobs()
            call.respond(jobs)
        }
    }

    route("/sync-runs") {
        get {
            val jobKey = call.request.queryParameters["jobKey"]
            val page = call.request.queryParameters["page"]?.toIntOrNull()
            val pageSize = call.request.queryParameters["pageSize"]?.toIntOrNull()

            val pageRequest = PageRequest.of(
                page = page,
                pageSize = pageSize,
                sort = null,
                direction = null,
                allowedSorts = emptySet(),
                defaultSort = "startedAt"
            )

            val result = syncRepo.getSyncRuns(jobKey, pageRequest)
            call.respond(result)
        }

        get("/{id}") {
            val id = call.parameters["id"] ?: throw InvalidQueryException("Sync run ID가 필요합니다.")
            val detail = syncRepo.getSyncRunById(id)
            call.respond(detail)
        }
    }

    // 7. Providers
    get("/providers") {
        val providers = providerService.getProviderStatus()
        call.respond(providers)
    }
}
