import * as crypto from 'crypto';

/**
 * Node.js 내장 crypto를 사용한 안전한 비밀번호 해싱 및 JWT 서명/검증 유틸리티.
 * 외부 의존성 없이 Scrypt 및 HMAC-SHA256 알고리즘을 사용합니다.
 */

// ─── 비밀번호 해싱 (Scrypt) ───────────────────────────────────────────────────

const SCRYPT_KEY_LEN = 64;
const SALT_LEN = 16;

/**
 * 비밀번호를 Scrypt 알고리즘으로 해시합니다.
 * 반환 형식: `scrypt:<salt_hex>:<hash_hex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * 비밀번호가 해시값과 일치하는지 timingSafeEqual로 안전하게 검증합니다.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHashHex] = parts;
  if (!salt || !expectedHashHex) {
    return false;
  }

  return new Promise((resolve) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LEN, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const expectedBuffer = Buffer.from(expectedHashHex, 'hex');
        if (derivedKey.length !== expectedBuffer.length) {
          return resolve(false);
        }
        resolve(crypto.timingSafeEqual(derivedKey, expectedBuffer));
      } catch {
        resolve(false);
      }
    });
  });
}

// ─── JWT 서명 및 검증 (HMAC-SHA256) ──────────────────────────────────────────

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export interface JwtTokenPayload {
  sub: string;
  email: string;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface SignJwtInput {
  sub: string;
  email: string;
  type: 'access';
  [key: string]: unknown;
}

/**
 * HS256 알고리즘으로 서명된 JWT 문자열을 생성합니다.
 */
export function signJwt(payload: SignJwtInput, secret: string, expiresInSeconds: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtTokenPayload = {
    sub: payload.sub,
    email: payload.email,
    type: payload.type,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${dataToSign}.${signature}`;
}

/**
 * JWT 문자열을 검증하고 페이로드를 복호화합니다.
 * 서명 불일치, 만료, 형식 오류 시 예외를 던집니다.
 */
export function verifyJwt(token: string, secret: string): JwtTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error('Invalid JWT token parts');
  }

  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid signature');
  }

  const payload: JwtTokenPayload = JSON.parse(base64UrlDecode(encodedPayload)) as JwtTokenPayload;
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp !== undefined && payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload;
}
