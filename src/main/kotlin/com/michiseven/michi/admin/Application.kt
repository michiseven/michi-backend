package com.michiseven.michi.admin

import com.michiseven.michi.admin.audit.AdminAuditLogResponse
import com.michiseven.michi.admin.audit.AuditLogFilter
import com.michiseven.michi.admin.audit.AuditLogRepository
import com.michiseven.michi.admin.auth.ADMIN_USER_KEY
import com.michiseven.michi.admin.auth.AdminLoginRequest
import com.michiseven.michi.admin.auth.AdminLoginResponse
import com.michiseven.michi.admin.auth.AdminLogoutResponse
import com.michiseven.michi.admin.auth.AdminPermission
import com.michiseven.michi.admin.auth.AdminUserDetailResponse
import com.michiseven.michi.admin.auth.AdminUserFilter
import com.michiseven.michi.admin.auth.AdminUserRecord
import com.michiseven.michi.admin.auth.AuthRepository
import com.michiseven.michi.admin.auth.AuthService
import com.michiseven.michi.admin.auth.InviteAdminUserRequest
import com.michiseven.michi.admin.auth.PasswordHasher
import com.michiseven.michi.admin.auth.RbacPolicy
import com.michiseven.michi.admin.auth.UpdateAdminUserRoleRequest
import com.michiseven.michi.admin.auth.UpdateAdminUserStatusRequest
import com.michiseven.michi.admin.auth.adminUser
import com.michiseven.michi.admin.common.AdminApiException
import com.michiseven.michi.admin.common.ApiErrorResponse
import com.michiseven.michi.admin.common.InvalidQueryException
import com.michiseven.michi.admin.common.PageRequest
import com.michiseven.michi.admin.common.ResourceNotFoundException
import com.michiseven.michi.admin.common.UnauthorizedException
import com.michiseven.michi.admin.common.requestId
import com.michiseven.michi.admin.config.AppConfig
import com.michiseven.michi.admin.dashboard.DashboardRepository
import com.michiseven.michi.admin.database.AdminMigrationRunner
import com.michiseven.michi.admin.database.DatabaseFactory
import com.michiseven.michi.admin.database.DatabaseHealthRepository
import com.michiseven.michi.admin.evaluations.EvaluationFilter
import com.michiseven.michi.admin.evaluations.EvaluationRepository
import com.michiseven.michi.admin.health.HealthService
import com.michiseven.michi.admin.imports.ImportRepository
import com.michiseven.michi.admin.imports.ImportRunFilter
import com.michiseven.michi.admin.members.MemberFilter
import com.michiseven.michi.admin.members.MemberRepository
import com.michiseven.michi.admin.places.PlaceFilter
import com.michiseven.michi.admin.places.PlaceRepository
import com.michiseven.michi.admin.providers.ProviderService
import com.michiseven.michi.admin.sync.SyncRepository
import io.ktor.http.Cookie
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.header
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.util.date.GMTDate
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import javax.sql.DataSource

fun main() {
    val config = AppConfig.load()
    if (config.adminMigrationsEnabled) {
        AdminMigrationRunner.migrate(config.adminDatabase)
    }
    val dataSource = DatabaseFactory.createDataSource(config.database)
    val adminDataSource = if (config.adminAuthMode == "session") {
        DatabaseFactory.createAdminDataSource(config.adminDatabase)
    } else {
        null
    }

    embeddedServer(Netty, port = config.port, host = config.host) {
        module(config, dataSource, adminDataSource = adminDataSource)
    }.start(wait = true)
}

fun Application.module(
    config: AppConfig,
    dataSource: DataSource,
    healthServiceOverride: HealthService? = null,
    providerServiceOverride: ProviderService? = null,
    adminDataSource: DataSource? = null,
    authServiceOverride: AuthService? = null,
    auditRepoOverride: AuditLogRepository? = null
) {
    val logger = LoggerFactory.getLogger("MichiAdminApp")

    val dbHealthRepo = DatabaseHealthRepository(dataSource)
    val healthService = healthServiceOverride ?: HealthService(dbHealthRepo, config)
    val dashboardRepo = DashboardRepository(dataSource)
    val placeRepo = PlaceRepository(dataSource)
    val memberRepo = MemberRepository(dataSource)
    val importRepo = ImportRepository(dataSource)
    val evalRepo = EvaluationRepository(dataSource)
    val syncRepo = SyncRepository(dataSource)
    val providerService = providerServiceOverride ?: ProviderService(config)
    val authService = authServiceOverride ?: adminDataSource?.let {
        AuthService(AuthRepository(it), PasswordHasher(), config.adminSessionTtlHours)
    }
    val auditRepo = auditRepoOverride ?: adminDataSource?.let {
        AuditLogRepository(it)
    }

    if (config.adminAuthMode == "session" && authService == null) {
        error("Session authentication requires an admin identity DataSource.")
    }

    install(CallLogging)

    install(CORS) {
        allowMethod(HttpMethod.Options)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Patch)
        allowMethod(HttpMethod.Delete)
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
        allowHeader(HttpHeaders.Accept)
        allowHeader("X-Request-Id")
        allowCredentials = true

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
            logger.error("Unhandled error [${reqId}]", cause)
            call.respond(
                HttpStatusCode.InternalServerError,
                ApiErrorResponse(
                    code = "ADMIN_INTERNAL_ERROR",
                    message = "서버 내부 오류가 발생했습니다.",
                    requestId = reqId
                )
            )
        }
    }

    routing {
        route(config.apiPrefix) {
            adminRoutes(
                healthService = healthService,
                dashboardRepo = dashboardRepo,
                placeRepo = placeRepo,
                memberRepo = memberRepo,
                importRepo = importRepo,
                evalRepo = evalRepo,
                syncRepo = syncRepo,
                providerService = providerService,
                authService = authService,
                auditRepo = auditRepo,
                config = config
            )
        }
    }
}

fun Route.adminRoutes(
    healthService: HealthService,
    dashboardRepo: DashboardRepository,
    placeRepo: PlaceRepository,
    memberRepo: MemberRepository,
    importRepo: ImportRepository,
    evalRepo: EvaluationRepository,
    syncRepo: SyncRepository,
    providerService: ProviderService,
    authService: AuthService?,
    auditRepo: AuditLogRepository?,
    config: AppConfig
) {
    fun resolveUser(call: ApplicationCall): AdminUserRecord {
        if (config.adminAuthMode == "disabled") {
            return AdminUserRecord(
                id = "00000000-0000-0000-0000-000000000001",
                email = "dev-owner@michi.local",
                displayName = "Dev Owner",
                passwordHash = null,
                role = "owner",
                status = "active"
            )
        }
        val token = call.request.cookies[ADMIN_SESSION_COOKIE]
        return authService?.authenticate(token)
            ?: throw UnauthorizedException()
    }

    fun getClientIp(call: ApplicationCall): String? {
        return call.request.headers["X-Forwarded-For"]?.substringBefore(',')?.trim()
    }

    // 0. Auth
    route("/auth") {
        post("/login") {
            if (config.adminAuthMode != "session" || authService == null) {
                throw AdminApiException(
                    "ADMIN_AUTH_DISABLED",
                    "관리자 세션 인증이 활성화되어 있지 않습니다.",
                    503
                )
            }
            val request = call.receive<AdminLoginRequest>()
            val requestId = call.requestId()
            val forwardedFor = call.request.headers["X-Forwarded-For"]?.substringBefore(',')?.trim()
            val clientKey = forwardedFor ?: call.request.headers["User-Agent"] ?: "unknown-client"
            val session = authService.login(
                email = request.email,
                password = request.password,
                requestId = requestId,
                clientKey = clientKey,
                ipAddress = forwardedFor
            )
            call.response.cookies.append(
                Cookie(
                    name = ADMIN_SESSION_COOKIE,
                    value = session.rawToken,
                    path = config.apiPrefix,
                    maxAge = (config.adminSessionTtlHours * 3600).toInt(),
                    secure = config.isProduction,
                    httpOnly = true,
                    extensions = mapOf("SameSite" to "Strict")
                )
            )
            call.respond(AdminLoginResponse(session.user, session.expiresAt))
        }

        get("/me") {
            val user = resolveUser(call)
            call.respond(user.toResponse())
        }

        post("/logout") {
            authService?.logout(
                call.request.cookies[ADMIN_SESSION_COOKIE],
                call.requestId(),
                getClientIp(call)
            )
            call.response.cookies.append(
                Cookie(
                    name = ADMIN_SESSION_COOKIE,
                    value = "",
                    path = config.apiPrefix,
                    maxAge = 0,
                    expires = GMTDate(0),
                    secure = config.isProduction,
                    httpOnly = true,
                    extensions = mapOf("SameSite" to "Strict")
                )
            )
            call.respond(AdminLogoutResponse())
        }
    }

    // 1. Users Management (RBAC: owner, admin)
    route("/users") {
        get {
            val actor = resolveUser(call)
            if (authService == null && config.adminAuthMode == "session") {
                throw AdminApiException("ADMIN_AUTH_DISABLED", "인증 서비스가 비활성화되어 있습니다.", 503)
            }

            val page = call.request.queryParameters["page"]?.toIntOrNull()
            val pageSize = call.request.queryParameters["pageSize"]?.toIntOrNull()
            val sort = call.request.queryParameters["sort"]
            val direction = call.request.queryParameters["direction"]

            val pageRequest = PageRequest.of(
                page = page,
                pageSize = pageSize,
                sort = sort,
                direction = direction,
                allowedSorts = AuthRepository.ALLOWED_SORTS.keys,
                defaultSort = "createdAt"
            )

            val filter = AdminUserFilter(
                query = call.request.queryParameters["query"],
                role = call.request.queryParameters["role"],
                status = call.request.queryParameters["status"]
            )

            val result = authService?.listUsers(actor, filter, pageRequest)
                ?: com.michiseven.michi.admin.common.PageResponse(
                    items = listOf(
                        AdminUserDetailResponse(
                            id = actor.id,
                            email = actor.email,
                            displayName = actor.displayName,
                            role = actor.role,
                            status = actor.status,
                            authProvider = "password",
                            lastLoginAt = null,
                            createdAt = "",
                            createdBy = null
                        )
                    ),
                    page = 1,
                    pageSize = 20,
                    totalItems = 1,
                    totalPages = 1
                )
            call.respond(result)
        }

        post("/invite") {
            val actor = resolveUser(call)
            if (authService == null) {
                throw AdminApiException("ADMIN_AUTH_DISABLED", "인증 서비스가 비활성화되어 있습니다.", 503)
            }
            val req = call.receive<InviteAdminUserRequest>()
            val created = authService.inviteUser(actor, req, call.requestId(), getClientIp(call))
            call.respond(HttpStatusCode.Created, created)
        }

        patch("/{id}/role") {
            val actor = resolveUser(call)
            if (authService == null) {
                throw AdminApiException("ADMIN_AUTH_DISABLED", "인증 서비스가 비활성화되어 있습니다.", 503)
            }
            val targetId = call.parameters["id"] ?: throw InvalidQueryException("사용자 ID가 필요합니다.")
            val req = call.receive<UpdateAdminUserRoleRequest>()
            val updated = authService.updateUserRole(actor, targetId, req.role, call.requestId(), getClientIp(call))
            call.respond(updated)
        }

        patch("/{id}/status") {
            val actor = resolveUser(call)
            if (authService == null) {
                throw AdminApiException("ADMIN_AUTH_DISABLED", "인증 서비스가 비활성화되어 있습니다.", 503)
            }
            val targetId = call.parameters["id"] ?: throw InvalidQueryException("사용자 ID가 필요합니다.")
            val req = call.receive<UpdateAdminUserStatusRequest>()
            val updated = authService.updateUserStatus(actor, targetId, req.status, call.requestId(), getClientIp(call))
            call.respond(updated)
        }
    }

    // 2. Audit Logs (RBAC: owner, admin)
    route("/audit-logs") {
        get {
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_AUDIT_LOGS)

            if (auditRepo == null) {
                call.respond(
                    com.michiseven.michi.admin.common.PageResponse<AdminAuditLogResponse>(
                        items = emptyList(),
                        page = 1,
                        pageSize = 20,
                        totalItems = 0,
                        totalPages = 0
                    )
                )
                return@get
            }

            val page = call.request.queryParameters["page"]?.toIntOrNull()
            val pageSize = call.request.queryParameters["pageSize"]?.toIntOrNull()
            val sort = call.request.queryParameters["sort"]
            val direction = call.request.queryParameters["direction"]

            val pageRequest = PageRequest.of(
                page = page,
                pageSize = pageSize,
                sort = sort,
                direction = direction,
                allowedSorts = AuditLogRepository.ALLOWED_SORTS.keys,
                defaultSort = "createdAt"
            )

            val filter = AuditLogFilter(
                adminUserId = call.request.queryParameters["adminUserId"],
                action = call.request.queryParameters["action"],
                resourceType = call.request.queryParameters["resourceType"],
                result = call.request.queryParameters["result"],
                requestId = call.request.queryParameters["requestId"],
                dateFrom = call.request.queryParameters["dateFrom"],
                dateTo = call.request.queryParameters["dateTo"]
            )

            val result = auditRepo.findAuditLogs(filter, pageRequest)
            call.respond(result)
        }
    }

    // 3. Health (Public or Viewer+)
    get("/health") {
        val health = healthService.checkHealth()
        call.respond(health)
    }

    // 4. Summary (RBAC: Viewer+)
    get("/summary") {
        val actor = resolveUser(call)
        RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)
        val summary = dashboardRepo.getSummary()
        call.respond(summary)
    }

    // 5. Places (RBAC: Viewer+)
    route("/places") {
        get {
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

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
                tourismMetricStatus = call.request.queryParameters["tourismMetricStatus"],
                priceEvidenceStatus = call.request.queryParameters["priceEvidenceStatus"]
            )

            val result = placeRepo.findPlaces(filter, pageRequest)
            call.respond(result)
        }

        get("/{id}") {
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

            val id = call.parameters["id"] ?: throw InvalidQueryException("장소 ID가 필요합니다.")
            val place = placeRepo.findPlaceById(id)
            call.respond(place)
        }
    }

    // 일반 여행자 회원은 admin 스키마의 관리자 계정과 분리해 읽기 전용으로 제공한다.
    route("/members") {
        get {
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)
            val pageRequest = PageRequest.of(
                page = call.request.queryParameters["page"]?.toIntOrNull(),
                pageSize = call.request.queryParameters["pageSize"]?.toIntOrNull(),
                sort = call.request.queryParameters["sort"],
                direction = call.request.queryParameters["direction"],
                allowedSorts = MemberRepository.ALLOWED_SORTS.keys,
                defaultSort = "createdAt"
            )
            call.respond(
                memberRepo.findMembers(
                    MemberFilter(
                        query = call.request.queryParameters["query"],
                        locale = call.request.queryParameters["locale"],
                        status = call.request.queryParameters["status"]
                    ),
                    pageRequest
                )
            )
        }
    }

    // 6. Import Runs (RBAC: Viewer+)
    route("/import-runs") {
        get {
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

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
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

            val id = call.parameters["id"] ?: throw InvalidQueryException("Import run ID가 필요합니다.")
            val detail = importRepo.findImportRunById(id)
            call.respond(detail)
        }
    }

    // 7. Evaluations (RBAC: Viewer+)
    route("/evaluations") {
        get {
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

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
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

            val id = call.parameters["id"] ?: throw InvalidQueryException("평가 ID가 필요합니다.")
            val detail = evalRepo.findEvaluationById(id)
            call.respond(detail)
        }
    }

    // 8. Sync Jobs & Runs (RBAC: Viewer+)
    route("/sync-jobs") {
        get {
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

            val jobs = syncRepo.getSyncJobs()
            call.respond(jobs)
        }
    }

    route("/sync-runs") {
        get {
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

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
            val actor = resolveUser(call)
            RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

            val id = call.parameters["id"] ?: throw InvalidQueryException("Sync run ID가 필요합니다.")
            val detail = syncRepo.getSyncRunById(id)
            call.respond(detail)
        }
    }

    // 9. Providers (RBAC: Viewer+)
    get("/providers") {
        val actor = resolveUser(call)
        RbacPolicy.checkPermission(actor, AdminPermission.READ_DATA)

        val providers = providerService.getProviderStatus()
        call.respond(providers)
    }
}

private const val ADMIN_SESSION_COOKIE = "michi_admin_session"
