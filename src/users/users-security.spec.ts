import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveTripDto, WithdrawDto } from './dto/users.dto';

describe('Users Security & DTO Validation', () => {
  it('rejects invalid UUID in SaveTripDto', async () => {
    const dto = plainToInstance(SaveTripDto, {
      tripId: 'not-a-valid-uuid',
      title: '테스트',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'tripId')).toBe(true);
  });

  it('accepts valid UUID in SaveTripDto', async () => {
    const dto = plainToInstance(SaveTripDto, {
      tripId: 'c1b4a621-e072-4d1a-85b3-85f838271032',
      title: '정상 일정',
      stopsCount: 4,
      estimatedTotalCost: 50000,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects negative stopsCount or excessive costs', async () => {
    const dto = plainToInstance(SaveTripDto, {
      tripId: 'c1b4a621-e072-4d1a-85b3-85f838271032',
      stopsCount: -1,
      estimatedTotalCost: -500,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'stopsCount')).toBe(true);
    expect(errors.some((e) => e.property === 'estimatedTotalCost')).toBe(true);
  });

  it('rejects memo exceeding 2000 characters', async () => {
    const longMemo = 'a'.repeat(2001);
    const dto = plainToInstance(SaveTripDto, {
      tripId: 'c1b4a621-e072-4d1a-85b3-85f838271032',
      memo: longMemo,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'memo')).toBe(true);
  });

  it('rejects short withdrawal password (<8 chars)', async () => {
    const dto = plainToInstance(WithdrawDto, {
      password: 'short',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});
