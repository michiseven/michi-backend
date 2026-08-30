import { hashPassword, signJwt, verifyJwt, verifyPassword } from './crypto-auth.util';

describe('crypto-auth.util', () => {
  describe('password hashing & verification', () => {
    it('should hash a password and verify it successfully', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);

      expect(hash).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong password', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword('WrongPassword123!', hash);
      expect(isValid).toBe(false);
    });

    it('should return false for malformed hash strings', async () => {
      expect(await verifyPassword('password', 'invalid-hash')).toBe(false);
      expect(await verifyPassword('password', 'scrypt:abc')).toBe(false);
    });
  });

  describe('JWT signing and verification', () => {
    const secret = 'test-secret-key-12345';

    it('should sign and verify a valid JWT token', () => {
      const token = signJwt(
        { sub: 'user-uuid-1', email: 'test@example.com', type: 'access' },
        secret,
        3600,
      );

      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      const payload = verifyJwt(token, secret);
      expect(payload.sub).toBe('user-uuid-1');
      expect(payload.email).toBe('test@example.com');
      expect(payload.type).toBe('access');
      expect(payload.exp).toBeDefined();
    });

    it('should reject token signed with wrong secret', () => {
      const token = signJwt(
        { sub: 'user-uuid-1', email: 'test@example.com', type: 'access' },
        secret,
        3600,
      );

      expect(() => verifyJwt(token, 'wrong-secret')).toThrow('Invalid signature');
    });

    it('should reject expired tokens', () => {
      const token = signJwt(
        { sub: 'user-uuid-1', email: 'test@example.com', type: 'access' },
        secret,
        -10, // expired 10 seconds ago
      );

      expect(() => verifyJwt(token, secret)).toThrow('Token expired');
    });

    it('should reject malformed tokens', () => {
      expect(() => verifyJwt('invalid.token', secret)).toThrow();
      expect(() => verifyJwt('a.b.c', secret)).toThrow();
    });
  });
});
