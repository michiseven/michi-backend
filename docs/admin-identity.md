# 관리자 회원 데이터 모델

Michi의 운영자 계정은 일반 여행 사용자와 분리하여 PostgreSQL의 `admin` 스키마에 저장한다. 기존 장소·관광·평가 데이터는 `public` 스키마에 있으며 Ktor Admin API에서 읽기 전용으로 접근한다.

```text
public 스키마                    admin 스키마
장소·관광·평가 데이터           admin_users
        ↑ SELECT 전용                ├── admin_sessions
        │                            └── admin_audit_logs
        └──────── Ktor Admin API ────────────────┘
```

## 테이블

### `admin.admin_users`

관리자 로그인 식별자와 상태, 역할을 보관한다.

- 이메일은 `LOWER(email)` 기준으로 중복을 막는다.
- 역할은 `owner`, `admin`, `operator`, `viewer`만 허용한다.
- 상태는 `invited`, `active`, `suspended`, `disabled`만 허용한다.
- 비밀번호 원문은 저장하지 않고 Argon2id hash만 `password_hash`에 저장한다.
- 일반 여행자 계정은 이 테이블에 저장하지 않는다.

### `admin.admin_sessions`

관리자 로그인 세션을 보관한다.

- 불투명한 Session Token 원문이 아니라 SHA-256 hash만 저장한다.
- 관리자가 삭제되면 관련 세션도 함께 삭제된다.
- 로그아웃과 강제 만료는 `revoked_at`으로 추적한다.
- 사용자가 `suspended` 또는 `disabled` 상태로 변경되면 모든 활성 세션이 즉시 취소된다.

### `admin.admin_audit_logs`

관리 작업의 성공, 실패, 권한 거부(`denied`) 결과를 보관한다.

- 사용자가 삭제되어도 감사 기록은 유지하고 `admin_user_id`만 `null`로 변경한다.
- Credential, Authorization header, Refresh Token, 비밀번호는 `before_data`, `after_data`, `metadata`에 기록하지 않는다.
- 감사 로그를 수정하거나 삭제하는 API는 제공하지 않는다.

## DB 권한 경계

Ktor는 두 연결을 구분한다.

- Core DataSource: `public` 스키마를 읽는 기존 read-only 연결
- Admin Identity DataSource: `admin` 스키마의 인증 데이터만 읽고 쓰는 연결

`search_path`는 보안 경계가 아니다. 운영 PostgreSQL 계정 자체에서 다음 권한을 강제해야 한다.

- `public` 스키마: `SELECT`만 허용
- `admin` 스키마: 인증 기능에 필요한 `SELECT`, `INSERT`, `UPDATE`, `DELETE` 허용
- DDL은 배포 시 사용하는 migration 계정에만 허용하는 것을 권장

## Migration

Flyway migration 파일:

```text
src/main/resources/db/migration/admin/V1__create_admin_identity_tables.sql
```

명시적으로 migration을 적용한다.

```bash
./gradlew migrateAdminSchema
```

서버 시작 시 자동 적용하려면 다음 값을 사용한다.

```env
ADMIN_MIGRATIONS_ENABLED=true
```

운영 환경에서는 자동 적용보다 배포 단계에서 `migrateAdminSchema`를 별도로 실행하는 방식을 권장한다.

## 현재 구현 범위

완료:

- 관리자 회원·세션·감사 로그 schema
- Flyway migration
- Core DB와 Admin Identity DB 설정 분리
- schema 제약조건 및 migration 멱등성 테스트
- Argon2id 비밀번호 hashing과 최초 Owner bootstrap CLI
- HttpOnly 불투명 세션 로그인·로그아웃·현재 사용자 API (`/auth/login`, `/auth/logout`, `/auth/me`)
- 로그인 실패 횟수 제한과 로그인·로그아웃 감사 로그
- 역할 기반 접근 제어(RBAC) 정책 및 미들웨어 (`owner`, `admin`, `operator`, `viewer`)
- 관리자 계정 목록 조회, 초대, 역할 변경, 상태 변경 REST API (`/users`)
- 계정 정지/비활성화 시 세션 일괄 취소 (`revokeAllSessionsForUser`)
- 관리자 감사 로그 조회 REST API (`/audit-logs`) 및 권한 거부(`denied`) 자동 감사 기록

미구현:

- 데이터 변경 API용 CSRF 방어

추가된 운영 조회 경계:

- 일반 여행자 회원은 `public.users`와 `public.user_saved_trips`에서 읽기 전용으로 조회한다.
- `/api/admin/members`는 비밀번호 hash, refresh token, 일정 snapshot과 메모를 반환하지 않는다.
- `michi-admin`의 `/members`와 `/users`를 분리해 일반 회원과 관리자 계정의 의미를 혼동하지 않게 한다.
