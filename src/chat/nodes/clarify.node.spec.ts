import { createClarifyNode } from './clarify.node';
import type { ChatState } from '../chat-state';

describe('createClarifyNode', () => {
  it.each([
    [
      'ko',
      '어떤 식사 종류',
      ['한식', '일식', '중식', '양식', '카페·디저트', '지역 대표 메뉴로 추천'],
    ],
    [
      'ja',
      'どの食事ジャンル',
      ['韓国料理', '日本料理', '中華料理', '洋食', 'カフェ・スイーツ', 'このエリアの名物に任せる'],
    ],
  ] as const)(
    'keeps the %s meal question and chip set aligned',
    async (locale, question, labels) => {
      const update = await createClarifyNode()({
        locale,
        clarificationKind: 'meal',
        clarificationQuestion: null,
        pendingQuestion: {
          id: 'meal-choice-1',
          target: 'meal',
          reason: 'meal_choice_required',
          revision: 1,
          options: [
            { id: 'korean', mealCuisine: 'korean' },
            { id: 'japanese', mealCuisine: 'japanese' },
            { id: 'chinese', mealCuisine: 'chinese' },
            { id: 'western', mealCuisine: 'western' },
            { id: 'cafe_dessert', mealCuisine: 'cafe_dessert' },
            { id: 'local_specialty', mealPreference: 'local_specialty' },
          ],
        },
      } as unknown as ChatState);
      const chips = update.actionChips as unknown as Array<{
        label: string;
        mealCuisine?: string;
        mealPreference?: string;
        questionId?: string;
        optionId?: string;
      }>;
      expect(update.responseMessage).toContain(question);
      expect(chips.map((chip) => chip.label)).toEqual(labels);
      expect(chips.slice(0, 5).map((chip) => chip.mealCuisine)).toEqual([
        'korean',
        'japanese',
        'chinese',
        'western',
        'cafe_dessert',
      ]);
      expect(chips.map((chip) => chip.questionId)).toEqual([
        'meal-choice-1',
        'meal-choice-1',
        'meal-choice-1',
        'meal-choice-1',
        'meal-choice-1',
        'meal-choice-1',
      ]);
      expect(chips.map((chip) => chip.optionId)).toEqual([
        'korean',
        'japanese',
        'chinese',
        'western',
        'cafe_dessert',
        'local_specialty',
      ]);
    },
  );
});
