import { classifyIntentRuleBased, extractExplicitSeoulArea } from './chat-intent';

describe('classifyIntentRuleBased', () => {
  it.each(['현재 전체 일정을 요약해줘', '現在の旅程全体を要約して'])(
    'routes a current-trip summary as read-only: %s',
    (text) => {
      expect(classifyIntentRuleBased(text, true).intent).toBe('summarize_trip');
      expect(classifyIntentRuleBased(text, false).intent).not.toBe('summarize_trip');
    },
  );
  it('retains confirmed edit routing when an edit also asks for a summary', () => {
    expect(classifyIntentRuleBased('1번째 카페를 바꾸고 전체 일정을 요약해줘', true).intent).toBe(
      'modify_trip',
    );
  });
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

  it('asks for a direction when a first-time visitor gives no usable itinerary detail', () => {
    expect(classifyIntentRuleBased('友達と週末にソウルで遊びたい', false)).toMatchObject({
      intent: 'clarify',
    });
  });

  it('extracts the user-written area for precedence over an inferred LLM area', () => {
    expect(extractExplicitSeoulArea('홍대에서 13시부터 18시까지 카페와 산책을 하고 싶어요')).toBe(
      '홍대',
    );
    expect(extractExplicitSeoulArea('성수 말고 홍대에서 카페를 즐기고 싶어요')).toBe('홍대');
    expect(extractExplicitSeoulArea('성수와 홍대에서 카페를 즐기고 싶어요')).toBe('홍대');
    expect(extractExplicitSeoulArea('合井でライブ音楽を楽しみたい')).toBe('합정');
    expect(extractExplicitSeoulArea('午後にカフェと散歩を楽しみたい')).toBeUndefined();
  });
});
