import * as crypto from 'crypto';

export type ProviderMode = 'mock' | 'live';
export type PlaceProviderLiveSource = 'naver' | 'kakao';

let devFallbackSecret: string | null = null;

export function resolveJwtAccessSecret(input: Record<string, unknown>): string {
  const isProduction = (input.NODE_ENV ?? process.env.NODE_ENV) === 'production';
  const secret = typeof input.JWT_ACCESS_SECRET === 'string' ? input.JWT_ACCESS_SECRET.trim() : '';

  if (secret && Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 bytes');
  }

  if (isProduction) {
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is required and must be at least 32 bytes in production');
    }
    return secret;
  }

  if (secret) {
    return secret;
  }

  // In non-production, generate a secure random 32-byte hex secret once per process lifetime
  if (!devFallbackSecret) {
    devFallbackSecret = crypto.randomBytes(32).toString('hex');
  }
  return devFallbackSecret;
}

function cookieSameSite(value: unknown): 'lax' | 'strict' | 'none' {
  const normalized = typeof value === 'string' ? value.toLowerCase().trim() : 'lax';
  if (normalized !== 'lax' && normalized !== 'strict' && normalized !== 'none') {
    throw new Error('AUTH_COOKIE_SAME_SITE must be lax, strict, or none');
  }
  return normalized;
}

function authCookieConfig(input: Record<string, unknown>): {
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
} {
  const isProduction = (input.NODE_ENV ?? process.env.NODE_ENV) === 'production';
  const configuredSecure = input.AUTH_COOKIE_SECURE;
  if (
    configuredSecure !== undefined &&
    configuredSecure !== true &&
    configuredSecure !== false &&
    configuredSecure !== 'true' &&
    configuredSecure !== 'false'
  ) {
    throw new Error('AUTH_COOKIE_SECURE must be true or false');
  }

  if (isProduction && (configuredSecure === false || configuredSecure === 'false')) {
    throw new Error('AUTH_COOKIE_SECURE cannot be false in production');
  }

  const secure = isProduction || configuredSecure === true || configuredSecure === 'true';
  const sameSite = cookieSameSite(input.AUTH_COOKIE_SAME_SITE);
  if (sameSite === 'none' && !secure) {
    throw new Error('AUTH_COOKIE_SAME_SITE=none requires AUTH_COOKIE_SECURE=true');
  }

  const configuredPath =
    typeof input.AUTH_COOKIE_PATH === 'string' ? input.AUTH_COOKIE_PATH.trim() : '/api/auth';
  if (!configuredPath.startsWith('/') || !/^\/[a-zA-Z0-9/_-]*$/.test(configuredPath)) {
    throw new Error('AUTH_COOKIE_PATH must be an absolute URL path');
  }

  return { secure, sameSite, path: configuredPath.replace(/\/$/, '') || '/' };
}

function providerMode(value: unknown, name: string): ProviderMode {
  const normalized = value ?? 'mock';
  if (normalized !== 'mock' && normalized !== 'live') {
    throw new Error(`${name} must be either "mock" or "live"`);
  }
  return normalized;
}

function placeProviderLiveSource(value: unknown): PlaceProviderLiveSource {
  const normalized = value ?? 'naver';
  if (normalized !== 'naver' && normalized !== 'kakao') {
    throw new Error('PLACE_PROVIDER_LIVE_SOURCE must be either "naver" or "kakao"');
  }
  return normalized;
}

function positiveInteger(value: unknown, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function positiveNumber(value: unknown, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function booleanValue(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function apiPrefix(value: unknown): string {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error('API_PREFIX must be a string');
  }
  const normalized = (value ?? 'api').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized || !/^[a-zA-Z0-9/_-]+$/.test(normalized)) {
    throw new Error('API_PREFIX must be a non-empty URL path without query parameters');
  }
  return normalized;
}

function subwaySearchType(value: unknown): 'duration' | 'distance' | 'transfer' {
  const normalized = value ?? 'duration';
  if (normalized !== 'duration' && normalized !== 'distance' && normalized !== 'transfer') {
    throw new Error('SEOUL_SUBWAY_SEARCH_TYPE must be duration, distance, or transfer');
  }
  return normalized;
}

export function resolveDatabaseUrl(input: Record<string, unknown>): string {
  if (typeof input.DATABASE_URL === 'string' && input.DATABASE_URL.trim().length > 0) {
    return input.DATABASE_URL.trim();
  }
  const host = typeof input.POSTGRES_HOST === 'string' ? input.POSTGRES_HOST.trim() : '';
  const database = typeof input.POSTGRES_DB === 'string' ? input.POSTGRES_DB.trim() : '';
  const user = typeof input.POSTGRES_USER === 'string' ? input.POSTGRES_USER.trim() : '';
  if (host && database && user) {
    const port = positiveInteger(input.POSTGRES_PORT, 5432, 'POSTGRES_PORT');
    const password = typeof input.POSTGRES_PASSWORD === 'string' ? input.POSTGRES_PASSWORD : '';
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
  }
  return 'postgresql://michi:michi@localhost:55432/michi';
}

function chatCheckpointerMode(value: unknown): 'memory' | 'postgres' {
  const normalized = typeof value === 'string' ? value.toLowerCase().trim() : 'memory';
  if (normalized !== 'memory' && normalized !== 'postgres') {
    throw new Error('CHAT_CHECKPOINTER_MODE must be either "memory" or "postgres"');
  }
  return normalized;
}

export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const placeProviderMode = providerMode(input.PLACE_PROVIDER_MODE, 'PLACE_PROVIDER_MODE');
  const placeProviderSource = placeProviderLiveSource(input.PLACE_PROVIDER_LIVE_SOURCE);
  const crowdProviderMode = providerMode(input.CROWD_PROVIDER_MODE, 'CROWD_PROVIDER_MODE');
  const llmProviderMode = providerMode(input.LLM_PROVIDER_MODE, 'LLM_PROVIDER_MODE');
  const ktoProviderMode = providerMode(input.KTO_PROVIDER_MODE, 'KTO_PROVIDER_MODE');
  const ktoDataLabProviderMode = providerMode(
    input.KTO_DATALAB_PROVIDER_MODE,
    'KTO_DATALAB_PROVIDER_MODE',
  );
  const routingProviderMode = providerMode(input.ROUTING_PROVIDER_MODE, 'ROUTING_PROVIDER_MODE');
  const authCookie = authCookieConfig(input);
  const placeDetailWebSearchEnabled = booleanValue(
    input.PLACE_DETAIL_WEB_SEARCH_ENABLED,
    false,
    'PLACE_DETAIL_WEB_SEARCH_ENABLED',
  );

  const seoulSubwayProviderMode = providerMode(
    input.SEOUL_SUBWAY_PROVIDER_MODE ?? 'mock',
    'SEOUL_SUBWAY_PROVIDER_MODE',
  );
  const seoulBusProviderMode = providerMode(
    input.SEOUL_BUS_PROVIDER_MODE ?? 'mock',
    'SEOUL_BUS_PROVIDER_MODE',
  );

  if (
    placeProviderMode === 'live' &&
    placeProviderSource === 'naver' &&
    (!input.NAVER_CLIENT_ID || !input.NAVER_CLIENT_SECRET)
  ) {
    throw new Error(
      'NAVER_CLIENT_ID and NAVER_CLIENT_SECRET are required when PLACE_PROVIDER_MODE=live',
    );
  }
  if (
    placeProviderMode === 'live' &&
    placeProviderSource === 'kakao' &&
    !input.KAKAO_REST_API_KEY
  ) {
    throw new Error(
      'KAKAO_REST_API_KEY is required when PLACE_PROVIDER_MODE=live and PLACE_PROVIDER_LIVE_SOURCE=kakao',
    );
  }
  if (crowdProviderMode === 'live' && !input.SEOUL_OPEN_DATA_API_KEY) {
    throw new Error('SEOUL_OPEN_DATA_API_KEY is required when CROWD_PROVIDER_MODE=live');
  }
  if (seoulSubwayProviderMode === 'live' && !input.SEOUL_OPEN_DATA_API_KEY) {
    throw new Error('SEOUL_OPEN_DATA_API_KEY is required when SEOUL_SUBWAY_PROVIDER_MODE=live');
  }
  if (llmProviderMode === 'live' && !input.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER_MODE=live');
  }
  if (placeDetailWebSearchEnabled && !input.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when PLACE_DETAIL_WEB_SEARCH_ENABLED=true');
  }
  if (ktoProviderMode === 'live' && !input.KTO_TOUR_API_KEY) {
    throw new Error('KTO_TOUR_API_KEY is required when KTO_PROVIDER_MODE=live');
  }
  if (ktoDataLabProviderMode === 'live' && !input.KTO_DATALAB_API_KEY) {
    throw new Error('KTO_DATALAB_API_KEY is required when KTO_DATALAB_PROVIDER_MODE=live');
  }
  return {
    ...input,
    NODE_ENV: input.NODE_ENV ?? 'development',
    PORT: positiveInteger(input.PORT ?? input.BACKEND_PORT, 4000, 'PORT'),
    API_PREFIX: apiPrefix(input.API_PREFIX),
    DATABASE_URL: resolveDatabaseUrl(input),
    PLACE_PROVIDER_MODE: placeProviderMode,
    PLACE_PROVIDER_LIVE_SOURCE: placeProviderSource,
    CROWD_PROVIDER_MODE: crowdProviderMode,
    LLM_PROVIDER_MODE: llmProviderMode,
    KTO_PROVIDER_MODE: ktoProviderMode,
    KTO_DATALAB_PROVIDER_MODE: ktoDataLabProviderMode,
    ROUTING_PROVIDER_MODE: routingProviderMode,
    ROUTING_SHORT_WALK_MAX_METERS: positiveInteger(
      input.ROUTING_SHORT_WALK_MAX_METERS,
      1000,
      'ROUTING_SHORT_WALK_MAX_METERS',
    ),
    ROUTING_SHORT_WALK_MIN_SAVINGS_MINUTES: positiveInteger(
      input.ROUTING_SHORT_WALK_MIN_SAVINGS_MINUTES,
      3,
      'ROUTING_SHORT_WALK_MIN_SAVINGS_MINUTES',
    ),
    SEOUL_SUBWAY_PROVIDER_MODE: seoulSubwayProviderMode,
    SEOUL_BUS_PROVIDER_MODE: seoulBusProviderMode,
    OPENAI_MODEL: input.OPENAI_MODEL ?? 'gpt-5.6-luna',
    OPENAI_WEB_SEARCH_MODEL: input.OPENAI_WEB_SEARCH_MODEL ?? input.OPENAI_MODEL ?? 'gpt-5.6-luna',
    PLACE_DETAIL_WEB_SEARCH_ENABLED: placeDetailWebSearchEnabled,
    PLACE_DETAIL_WEB_CACHE_TTL_SECONDS: positiveInteger(
      input.PLACE_DETAIL_WEB_CACHE_TTL_SECONDS,
      86_400,
      'PLACE_DETAIL_WEB_CACHE_TTL_SECONDS',
    ),
    CORS_ORIGIN: input.CORS_ORIGIN ?? input.FRONTEND_ORIGIN ?? 'http://localhost:3000',
    PROVIDER_CACHE_TTL_SECONDS: positiveInteger(
      input.PROVIDER_CACHE_TTL_SECONDS,
      300,
      'PROVIDER_CACHE_TTL_SECONDS',
    ),
    NAVER_LOCAL_SEARCH_URL:
      input.NAVER_LOCAL_SEARCH_URL ?? 'https://naverapihub.apigw.ntruss.com/search/v1/local',
    KAKAO_LOCAL_SEARCH_URL:
      input.KAKAO_LOCAL_SEARCH_URL ?? 'https://dapi.kakao.com/v2/local/search/keyword.json',
    NAVER_DIRECTIONS_URL:
      input.NAVER_DIRECTIONS_URL ?? 'https://naveropenapi.apigw.ntruss.com/map-direction/v1',
    ACCESSIBILITY_CORRIDOR_METERS: positiveNumber(
      input.ACCESSIBILITY_CORRIDOR_METERS,
      20,
      'ACCESSIBILITY_CORRIDOR_METERS',
    ),
    ACCESSIBILITY_ELEVATION_SEARCH_METERS: positiveNumber(
      input.ACCESSIBILITY_ELEVATION_SEARCH_METERS,
      200,
      'ACCESSIBILITY_ELEVATION_SEARCH_METERS',
    ),
    ACCESSIBILITY_STEEP_SLOPE_PERCENT: positiveNumber(
      input.ACCESSIBILITY_STEEP_SLOPE_PERCENT,
      8,
      'ACCESSIBILITY_STEEP_SLOPE_PERCENT',
    ),
    KTO_TOUR_API_BASE_URL:
      input.KTO_TOUR_API_BASE_URL ?? 'https://apis.data.go.kr/B551011/JpnService2',
    KTO_DATALAB_CONCENTRATION_URL:
      input.KTO_DATALAB_CONCENTRATION_URL ??
      'https://apis.data.go.kr/B551011/TatsCnctrRateService/tatsCnctrRatedList',
    KTO_MOBILE_APP: input.KTO_MOBILE_APP ?? 'Michi',
    SEOUL_OPEN_DATA_BASE_URL: input.SEOUL_OPEN_DATA_BASE_URL ?? 'http://openapi.seoul.go.kr:8088',
    SEOUL_SUBWAY_API_BASE_URL: input.SEOUL_SUBWAY_API_BASE_URL ?? 'http://openapi.seoul.go.kr:8088',
    SEOUL_SUBWAY_SEARCH_TYPE: subwaySearchType(input.SEOUL_SUBWAY_SEARCH_TYPE),
    SEOUL_SUBWAY_MAX_ACCESS_METERS: positiveInteger(
      input.SEOUL_SUBWAY_MAX_ACCESS_METERS,
      1500,
      'SEOUL_SUBWAY_MAX_ACCESS_METERS',
    ),
    SEOUL_SUBWAY_STATION_SERVICE: input.SEOUL_SUBWAY_STATION_SERVICE ?? 'subwayStationMaster',
    SEOUL_BUS_STATION_SERVICE: input.SEOUL_BUS_STATION_SERVICE ?? 'tbisMasterStation',
    JWT_ACCESS_SECRET: resolveJwtAccessSecret(input),
    AUTH_COOKIE_SECURE: authCookie.secure,
    AUTH_COOKIE_SAME_SITE: authCookie.sameSite,
    AUTH_COOKIE_PATH: authCookie.path,
    CHAT_GRAPH_ENABLED: input.CHAT_GRAPH_ENABLED !== 'false' && input.CHAT_GRAPH_ENABLED !== false,
    CHAT_CHECKPOINTER_MODE: chatCheckpointerMode(input.CHAT_CHECKPOINTER_MODE),
    CHAT_CHECKPOINT_RETENTION_DAYS: positiveInteger(
      input.CHAT_CHECKPOINT_RETENTION_DAYS,
      30,
      'CHAT_CHECKPOINT_RETENTION_DAYS',
    ),
    LOG_FRIENDS_INGEST_URL:
      typeof input.LOG_FRIENDS_INGEST_URL === 'string'
        ? input.LOG_FRIENDS_INGEST_URL.trim()
        : undefined,
    LOG_FRIENDS_WORKER_ID:
      typeof input.LOG_FRIENDS_WORKER_ID === 'string'
        ? input.LOG_FRIENDS_WORKER_ID.trim()
        : 'michi-backend',
  };
}
