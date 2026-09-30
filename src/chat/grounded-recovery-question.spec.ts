const parse = jest.fn<Promise<unknown>, [{ input: Array<{ role: string; content: string }> }]>();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(() => ({ responses: { parse } })),
}));
import { groundedRecoveryQuestion } from './grounded-recovery-question';

describe('grounded recovery question', () => {
  beforeEach(() => parse.mockReset());
  it('passes the original request and server failure as data', async () => {
    parse.mockResolvedValue({
      output_parsed: { question: '같은 지역에서 다른 음식 종류도 괜찮으세요?' },
    });
    const result = await groundedRecoveryQuestion(
      'test',
      '종로에서 점심',
      '일식 후보를 확인하지 못했습니다.',
      'ko',
    );
    expect(result).toContain('음식 종류');
    expect(parse.mock.calls[0]?.[0].input[1]?.content).toBe(
      JSON.stringify({
        originalRequest: '종로에서 점심',
        verifiedFailure: '일식 후보를 확인하지 못했습니다.',
      }),
    );
  });
  it('falls back when the wording provider fails', async () => {
    parse.mockRejectedValue(new Error('unavailable'));
    await expect(groundedRecoveryQuestion('test', '종로', '후보 부족', 'ko')).resolves.toBeNull();
  });
});
