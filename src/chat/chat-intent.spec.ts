import { classifyIntentRuleBased } from './chat-intent';

describe('classifyIntentRuleBased', () => {
  it('asks exactly one structured meal question for a Japanese broad food request before creation', () => {
    expect(classifyIntentRuleBased('弘大で午後にグルメとカフェを楽しみたい', false)).toMatchObject({
      intent: 'clarify',
      clarificationKind: 'meal',
    });
  });

  it('creates a Japanese broad activity request with product defaults when no area is supplied', () => {
    expect(classifyIntentRuleBased('午後にカフェと散歩を楽しみたい', false)).toMatchObject({
      intent: 'create_trip',
      createTripInput: { startArea: '성수' },
    });
  });
});
