import { classifyIntentRuleBased, extractExplicitSeoulArea } from './chat-intent';

describe('classifyIntentRuleBased', () => {
  it('asks exactly one structured meal question for a Japanese broad food request before creation', () => {
    expect(classifyIntentRuleBased('弘大で午後にグルメとカフェを楽しみたい', false)).toMatchObject({
      intent: 'clarify',
      clarificationKind: 'meal',
    });
  });

  it('does not force an area when a Japanese broad activity request has no area', () => {
    expect(classifyIntentRuleBased('午後にカフェと散歩を楽しみたい', false)).toMatchObject({
      intent: 'create_trip',
      createTripInput: { startArea: undefined },
    });
  });

  it('extracts the user-written area for precedence over an inferred LLM area', () => {
    expect(extractExplicitSeoulArea('홍대에서 13시부터 18시까지 카페와 산책을 하고 싶어요')).toBe(
      '홍대',
    );
    expect(extractExplicitSeoulArea('성수 말고 홍대에서 카페를 즐기고 싶어요')).toBe('홍대');
    expect(extractExplicitSeoulArea('성수와 홍대에서 카페를 즐기고 싶어요')).toBe('홍대');
    expect(extractExplicitSeoulArea('午後にカフェと散歩を楽しみたい')).toBeUndefined();
  });
});
