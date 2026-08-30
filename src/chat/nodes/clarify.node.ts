import type { ChatState, ChatUpdate } from '../chat-state';

export function createClarifyNode() {
  return (state: ChatState): Promise<ChatUpdate> => {
    const isKo = state.locale === 'ko';

    const responseMessage = isKo
      ? '어떤 분위기의 서울 여행을 원하시나요? 아래 추천 코스 중 마음에 드는 테마를 선택해 주시면 딱 맞는 최적 동선으로 안내해 드릴게요! ✨'
      : 'どのような雰囲気のソウル旅行をご希望ですか？以下の人気コースから気になるものをお選びください！✨';

    const actionChips = isKo
      ? [
          {
            label: '☕ 성수: 감성 카페 & 팝업 쇼핑',
            query: '성수동에서 감성 카페와 소품샵 쇼핑 코스로 짜줘',
            type: 'clarify',
          },
          {
            label: '🛍️ 홍대/연남: 핫플 투어 & 맛집',
            query: '홍대와 연남동 핫플 맛집 & 쇼핑 코스로 짜줘',
            type: 'clarify',
          },
          {
            label: '🏯 서촌/안국: 한옥 산책 & 미식',
            query: '서촌과 안국동 경복궁 한옥 산책 & 전통 맛집으로 짜줘',
            type: 'clarify',
          },
          {
            label: '🍜 명동/을지로: K-푸드 & 힙지로',
            query: '명동 K-푸드 먹방과 을지로 힙지로 투어로 짜줘',
            type: 'clarify',
          },
        ]
      : [
          {
            label: '☕ 聖水: カフェ＆ポップアップ',
            query: '聖水洞でカフェとポップアップ巡りプランを作って',
            type: 'clarify',
          },
          {
            label: '🛍️ 弘大/延南: トレンド＆グルメ',
            query: '弘大と延南洞のグルメ＆ショッピングプランを作って',
            type: 'clarify',
          },
          {
            label: '🏯 西村/安国: 韓屋散歩＆伝統',
            query: '西村と安国洞の韓屋散歩＆伝統グルメコースを作って',
            type: 'clarify',
          },
          {
            label: '🍜 明洞/乙支路: 定番Kフード',
            query: '明洞の定番グルメと乙支路レトロツアーを作って',
            type: 'clarify',
          },
        ];

    return Promise.resolve({
      responseMessage,
      actionChips,
      status: 'completed',
    });
  };
}
