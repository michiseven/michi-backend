import { resolveDatabaseUrl, validateEnvironment } from './env.validation';

describe('environment validation', () => {
  it('defaults every external adapter to explicit mock mode', () => {
    expect(validateEnvironment({})).toMatchObject({
      API_PREFIX: 'api',
      PLACE_PROVIDER_MODE: 'mock',
      CROWD_PROVIDER_MODE: 'mock',
      LLM_PROVIDER_MODE: 'mock',
      KTO_PROVIDER_MODE: 'mock',
      KTO_DATALAB_PROVIDER_MODE: 'mock',
      PLACE_PROVIDER_LIVE_SOURCE: 'naver',
      NAVER_LOCAL_SEARCH_URL: 'https://naverapihub.apigw.ntruss.com/search/v1/local',
      KAKAO_LOCAL_SEARCH_URL: 'https://dapi.kakao.com/v2/local/search/keyword.json',
      ROUTING_SHORT_WALK_MAX_METERS: 1000,
      ROUTING_SHORT_WALK_MIN_SAVINGS_MINUTES: 3,
      PLACE_DETAIL_WEB_SEARCH_ENABLED: false,
      PLACE_DETAIL_WEB_CACHE_TTL_SECONDS: 86400,
    });
  });

  it('normalizes a deployment API prefix', () => {
    expect(validateEnvironment({ API_PREFIX: '/michi/api/' }).API_PREFIX).toBe('michi/api');
  });

  it('rejects an unsafe API prefix', () => {
    expect(() => validateEnvironment({ API_PREFIX: 'michi/api?debug=true' })).toThrow('API_PREFIX');
  });

  it('requires credentials for each live adapter', () => {
    expect(() => validateEnvironment({ PLACE_PROVIDER_MODE: 'live' })).toThrow('NAVER_CLIENT_ID');
    expect(() => validateEnvironment({ CROWD_PROVIDER_MODE: 'live' })).toThrow(
      'SEOUL_OPEN_DATA_API_KEY',
    );
    expect(() => validateEnvironment({ LLM_PROVIDER_MODE: 'live' })).toThrow('OPENAI_API_KEY');
    expect(() => validateEnvironment({ KTO_PROVIDER_MODE: 'live' })).toThrow('KTO_TOUR_API_KEY');
    expect(() => validateEnvironment({ KTO_DATALAB_PROVIDER_MODE: 'live' })).toThrow(
      'KTO_DATALAB_API_KEY',
    );
    expect(() => validateEnvironment({ SEOUL_SUBWAY_PROVIDER_MODE: 'live' })).toThrow(
      'SEOUL_OPEN_DATA_API_KEY',
    );
    expect(() => validateEnvironment({ PLACE_DETAIL_WEB_SEARCH_ENABLED: 'true' })).toThrow(
      'OPENAI_API_KEY',
    );
  });

  it('enables on-demand place detail web search with an explicit cache TTL', () => {
    expect(
      validateEnvironment({
        OPENAI_API_KEY: 'test-key',
        PLACE_DETAIL_WEB_SEARCH_ENABLED: 'true',
        PLACE_DETAIL_WEB_CACHE_TTL_SECONDS: '3600',
      }),
    ).toMatchObject({
      PLACE_DETAIL_WEB_SEARCH_ENABLED: true,
      PLACE_DETAIL_WEB_CACHE_TTL_SECONDS: 3600,
    });
    expect(() =>
      validateEnvironment({
        OPENAI_API_KEY: 'test-key',
        PLACE_DETAIL_WEB_SEARCH_ENABLED: 'yes',
      }),
    ).toThrow('PLACE_DETAIL_WEB_SEARCH_ENABLED');
  });

  it('requires only the selected live place provider credential', () => {
    expect(() =>
      validateEnvironment({
        PLACE_PROVIDER_MODE: 'live',
        PLACE_PROVIDER_LIVE_SOURCE: 'kakao',
      }),
    ).toThrow('KAKAO_REST_API_KEY');
    expect(
      validateEnvironment({
        PLACE_PROVIDER_MODE: 'live',
        PLACE_PROVIDER_LIVE_SOURCE: 'kakao',
        KAKAO_REST_API_KEY: 'test-key',
      }),
    ).toMatchObject({
      PLACE_PROVIDER_MODE: 'live',
      PLACE_PROVIDER_LIVE_SOURCE: 'kakao',
    });
    expect(() => validateEnvironment({ PLACE_PROVIDER_LIVE_SOURCE: 'unknown' })).toThrow(
      'PLACE_PROVIDER_LIVE_SOURCE',
    );
  });

  it('allows composite routing without NAVER taxi credentials', () => {
    expect(validateEnvironment({ ROUTING_PROVIDER_MODE: 'live' }).ROUTING_PROVIDER_MODE).toBe(
      'live',
    );
  });

  it('validates official subway search types', () => {
    expect(validateEnvironment({ SEOUL_SUBWAY_SEARCH_TYPE: 'transfer' })).toMatchObject({
      SEOUL_SUBWAY_SEARCH_TYPE: 'transfer',
    });
    expect(() => validateEnvironment({ SEOUL_SUBWAY_SEARCH_TYPE: '0' })).toThrow(
      'SEOUL_SUBWAY_SEARCH_TYPE',
    );
  });

  it('builds a URL from split PostgreSQL settings when DATABASE_URL is blank', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: '',
        POSTGRES_HOST: '192.168.0.112',
        POSTGRES_PORT: '5433',
        POSTGRES_DB: 'michi',
        POSTGRES_USER: 'michi user',
        POSTGRES_PASSWORD: 'p@ss:word',
      }),
    ).toBe('postgresql://michi%20user:p%40ss%3Aword@192.168.0.112:5433/michi');
  });

  it('rejects missing or short JWT secret in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: '',
      }),
    ).toThrow('JWT_ACCESS_SECRET');

    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'too-short-secret-12345',
      }),
    ).toThrow('at least 32 bytes');
  });

  it('accepts valid 32+ character JWT secret in production', () => {
    const validSecret = 'a-very-secure-random-jwt-access-secret-for-production-2026';
    const env = validateEnvironment({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: validSecret,
    });
    expect(env.JWT_ACCESS_SECRET).toBe(validSecret);
    expect(env.AUTH_COOKIE_SECURE).toBe(true);
    expect(env.AUTH_COOKIE_SAME_SITE).toBe('lax');
  });

  it('rejects disabling secure auth cookies in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a-very-secure-random-jwt-access-secret-for-production-2026',
        AUTH_COOKIE_SECURE: 'false',
      }),
    ).toThrow('AUTH_COOKIE_SECURE cannot be false in production');
  });

  it('requires secure cookies when SameSite is none', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'development',
        AUTH_COOKIE_SECURE: 'false',
        AUTH_COOKIE_SAME_SITE: 'none',
      }),
    ).toThrow('AUTH_COOKIE_SAME_SITE=none requires AUTH_COOKIE_SECURE=true');

    expect(
      validateEnvironment({
        NODE_ENV: 'development',
        AUTH_COOKIE_SECURE: 'true',
        AUTH_COOKIE_SAME_SITE: 'none',
      }),
    ).toMatchObject({ AUTH_COOKIE_SECURE: true, AUTH_COOKIE_SAME_SITE: 'none' });
  });

  it('validates and normalizes the auth cookie path', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'development',
        AUTH_COOKIE_PATH: '/michi/api/auth/',
      }).AUTH_COOKIE_PATH,
    ).toBe('/michi/api/auth');
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'development',
        AUTH_COOKIE_PATH: 'michi/api/auth',
      }),
    ).toThrow('AUTH_COOKIE_PATH');
  });

  it('generates secure random secret in development if not provided', () => {
    const env = validateEnvironment({ NODE_ENV: 'development' });
    expect(typeof env.JWT_ACCESS_SECRET).toBe('string');
    expect((env.JWT_ACCESS_SECRET as string).length).toBeGreaterThanOrEqual(32);
  });
});
