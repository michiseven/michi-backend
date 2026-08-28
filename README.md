# Michi Backend (Admin API)

Michi 관리자 시스템을 위한 Kotlin / Ktor REST API 서버입니다. 기존 Michi 운영 데이터는 읽기 전용으로 조회하며, 관리자 인증 데이터는 별도의 `admin` 스키마로 분리합니다.

## 아키텍처 및 원칙

```text
michi-admin (Next.js, port 3100)
        ↓ /api/admin/*
michi-backend (Kotlin/Ktor Admin API, port 4100)
        ├── Core read-only pool ──→ public 스키마
        └── Admin identity pool ──→ admin 스키마
                     PostgreSQL/PostGIS michi DB
```

- **운영 데이터 Read-only 보장**: Core HikariCP 커넥션 풀에 `SET default_transaction_read_only = on`을 강제 적용합니다. 관리자 인증용 연결은 `admin` 스키마에만 쓰기 권한을 가진 별도 DB 계정을 사용해야 합니다.
- **Migration 소유권**: 기존 `public` 스키마의 TypeORM migration은 NestJS 백엔드(`backend/`)가 계속 소유합니다. Ktor는 자신이 사용하는 `admin` 인증 스키마만 Flyway로 관리합니다.
- **결정론적 계산**: `ExpectedDispersionEffect v1` 지표 계산은 TypeScript 백엔드 엔진과 동일한 공식으로 순수 함수 처리되어 일관성을 보장합니다.
- **보안 및 환경 검증**: `ADMIN_AUTH_MODE=disabled`는 로컬 개발/테스트(`development`/`test`) 환경에서만 허용되며, 운영 환경(`APP_ENV=production`)에서 시도 시 서버 기동이 즉시 거부(Fast-fail)됩니다.
- **민감정보 보호**: 외부 API 키, 데이터베이스 패스워드, 스택 트레이스 및 내부 SQL 오류는 API 응답에 절대 노출되지 않습니다.

## 구현된 Admin API Endpoints

Base URL: `http://localhost:4100/api/admin`

| HTTP Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/api/admin/health` | Ktor 서버, DB 연결(`SELECT 1`), Public API 헬스 종합 상태 |
| `POST` | `/api/admin/auth/login` | 이메일·비밀번호 확인 후 HttpOnly 세션 발급 |
| `GET` | `/api/admin/auth/me` | 현재 관리자 세션과 사용자 정보 확인 |
| `POST` | `/api/admin/auth/logout` | 현재 세션 폐기 및 쿠키 만료 |
| `GET` | `/api/admin/summary` | 대시보드 요약 (동적 장소 source, 가격 근거 coverage, 일반 회원, 지표, Import/평가) |
| `GET` | `/api/admin/places` | 장소 목록 페이징 및 필터링 (KTO/NAVER/Kakao, 좌표·관광 지표·가격 근거 상태) |
| `GET` | `/api/admin/places/{id}` | 장소 상세 (WGS84, 관광 지표, 예상 비용과 근거, 민감 키가 제거된 메타데이터) |
| `GET` | `/api/admin/members` | 일반 여행자 회원 목록 (언어·활성 상태·저장 일정 수, 인증 정보 제외) |
| `GET` | `/api/admin/import-runs` | 관광 데이터셋 수동 Import 실행 이력 목록 |
| `GET` | `/api/admin/import-runs/{id}` | Import 상세 (Lineage, 12자리 SHA-256 Checksum prefix, 거절 내역) |
| `GET` | `/api/admin/evaluations` | Baseline vs Michi 비교 평가 목록 |
| `GET` | `/api/admin/evaluations/{id}` | 평가 상세 (Snapshot 원본 및 Ktor 재계산 `ExpectedDispersionEffect v1` 지표) |
| `GET` | `/api/admin/sync-jobs` | KTO/DataLab 동기화 작업 목록 (`mutationEnabled=false`, `historyStatus="unavailable"`) |
| `GET` | `/api/admin/sync-runs` | 동기화 실행 이력 목록 |
| `GET` | `/api/admin/sync-runs/{id}` | 동기화 실행 상세 |
| `GET` | `/api/admin/providers` | Public API Provider 모드와 실제 장소·혼잡 source, Routing·접근성 상태 조회 |

## 환경변수 설정

`.env.example`을 참고하여 실행 환경을 구성합니다.

| 환경변수 | 기본값 | 필수/설명 |
| --- | --- | --- |
| `APP_ENV` | `development` | 실행 환경 (`development` / `production` / `test`) |
| `HOST` | `0.0.0.0` | 바인딩 호스트 |
| `PORT` | `4100` | 서버 포트 |
| `API_PREFIX` | `/api/admin` | API 기본 경로 프리픽스 |
| `POSTGRES_HOST` | `localhost` | PostgreSQL 호스트 |
| `POSTGRES_PORT` | `5432` | PostgreSQL 포트 |
| `POSTGRES_DB` | `michi` | PostgreSQL 데이터베이스 이름 |
| `POSTGRES_USER` | `postgres` | 읽기 권한을 가진 DB 사용자 계정 |
| `POSTGRES_PASSWORD` | - | DB 사용자 패스워드 |
| `DATABASE_SSL` | `false` | SSL 연결 여부 |
| `ADMIN_POSTGRES_HOST` | `POSTGRES_HOST` 값 | 관리자 인증 DB 호스트 |
| `ADMIN_POSTGRES_PORT` | `POSTGRES_PORT` 값 | 관리자 인증 DB 포트 |
| `ADMIN_POSTGRES_DB` | `POSTGRES_DB` 값 | 관리자 인증 DB 이름 |
| `ADMIN_POSTGRES_USER` | `POSTGRES_USER` 값 | `admin` 스키마 쓰기 전용 계정 |
| `ADMIN_POSTGRES_PASSWORD` | `POSTGRES_PASSWORD` 값 | 관리자 인증 DB 패스워드 |
| `ADMIN_DATABASE_SSL` | `DATABASE_SSL` 값 | 관리자 인증 DB SSL 여부 |
| `ADMIN_MIGRATIONS_ENABLED` | `false` | 서버 시작 전 Admin Flyway migration 실행 여부 |
| `MICHI_PUBLIC_API_URL` | `http://localhost:4000/api` | 기존 Michi Public API 엔드포인트 |
| `ADMIN_CORS_ORIGIN` | `http://localhost:3100` | CORS 허용 오리진 (Admin UI) |
| `ADMIN_AUTH_MODE` | `disabled` | 관리자 인증 모드 (`disabled` / `session`). `production`에서는 `disabled` 불가 |
| `ADMIN_SESSION_TTL_HOURS` | `12` | 관리자 세션 유지 시간, 1~168시간 |

## 실행 및 빌드

### 요구사항
- Java 21+
- PostgreSQL / PostGIS DB

### 서버 실행
```bash
./gradlew run
```

### 테스트 및 빌드
```bash
./gradlew clean test
./gradlew build
```

### 관리자 회원 스키마 생성

관리자 회원, 세션, 감사 로그 테이블은 `admin` 스키마에 생성됩니다.

```bash
./gradlew migrateAdminSchema
```

최초 Owner는 `.env`의 `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_DISPLAY_NAME`, `ADMIN_BOOTSTRAP_PASSWORD`를 입력한 뒤 생성합니다. 비밀번호는 12자 이상이어야 하며 원문은 DB에 저장되지 않습니다.

```bash
./gradlew bootstrapAdminOwner
```

생성 후 `.env`에서 `ADMIN_BOOTSTRAP_PASSWORD` 값을 제거하고 `ADMIN_AUTH_MODE=session`으로 변경합니다.

기존 장소·관광 데이터가 있는 `public` 스키마의 migration은 실행하지 않습니다. 상세 모델과 권한 원칙은 [`docs/admin-identity.md`](docs/admin-identity.md)를 참고하세요.

> **DB 통합 테스트 안내**: `DatabaseIntegrationTest`는 PostGIS Testcontainers를 사용합니다. 로컬 머신에 Docker 데몬이 실행 중이지 않은 환경에서는 JUnit Assumption에 의해 테스트가 **SKIPPED** 처리됩니다.

## VS Code 디버깅
1. VS Code Task: `Michi Admin API: Run (Debug JVM 5005)` 실행
2. VS Code Run & Debug: `Michi Admin API: Attach Remote JVM (Port 5005)` 선택 후 F5
