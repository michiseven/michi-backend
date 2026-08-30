import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ParsePreferenceDto } from './parse-preference.dto';

describe('ParsePreferenceDto', () => {
  it('validates a supported request', async () => {
    const dto = plainToInstance(ParsePreferenceDto, {
      text: '明日、聖水で一人で遊びたい。',
      startTime: '13:00',
      endTime: '21:00',
      budget: 80_000,
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects blank text and invalid clock values', async () => {
    const dto = plainToInstance(ParsePreferenceDto, {
      text: '',
      startTime: '30:00',
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['text', 'startTime']),
    );
  });
});
