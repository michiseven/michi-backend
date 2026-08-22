# Michi Backend (Admin API)

Michi 관리자 시스템을 위한 Kotlin / Ktor 기반의 읽기 전용(Read-only) REST API 서버입니다.

## 아키텍처 원칙
- **DB Read-only 보장**: HikariCP 풀 및 커넥션 초기화 시 `SET default_transaction_read_only = on`을 강제하며, 코드베이스 내 `SELECT` 쿼리만 실행합니다.
- **Migration 소유권**: TypeORM 마이그레이션 및 스키마 관리는 기존 NestJS 백엔드(`michi/backend`)의 권한을 유지하며, Ktor는 스키마 변경이나 자동 DDL을 수행하지 않습니다.
- **결정론적 계산**: `ExpectedDispersionEffect` 지표 계산은 TypeScript 구현과 동일한 공식으로 순수 함수 처리됩니다.
- **보안 경계**: `ADMIN_AUTH_MODE=disabled`는 development/test 환경에서만 허용되며, `APP_ENV=production` 시 서버 기동이 거부됩니다.

## 실행 및 빌드

### 요구사항
- Java 21+
- PostgreSQL / PostGIS DB

### 개발 모드 실행
```bash
./gradlew run
```
기본 포트는 `4100` (`http://localhost:4100/api/admin`) 입니다.

### 테스트 및 빌드
```bash
./gradlew clean test
./gradlew build
```

## VS Code 디버깅
1. VS Code Task: `Michi Admin API: Run (Debug JVM 5005)` 실행
2. VS Code Run & Debug: `Michi Admin API: Attach Remote JVM (Port 5005)` 선택 후 F5
