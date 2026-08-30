import type { ChatState, ChatUpdate } from '../chat-state';

export function createAnswerGroundedQuestionNode() {
  return (state: ChatState): Promise<ChatUpdate> => {
    const facts = state.verifiedPlaceFacts;
    const isKo = state.locale === 'ko';
    const webEvidence = facts?.webEvidence;

    if (!facts) {
      const fallbackMsg = isKo
        ? '문의하신 장소에 대한 공식 등록 정보를 데이터베이스에서 찾을 수 없습니다. 장소명을 정확히 입력해 주시거나 다른 서울 관광지에 대해 문의해 주세요! 😊'
        : 'お問い合わせいただいたスポットの公式情報が見つかりませんでした。スポット名を正確にご入力いただくか、他のソウルのスポットについてお尋ねください！😊';
      return Promise.resolve({
        responseMessage: fallbackMsg,
        status: 'completed',
      });
    }

    // Build grounded facts summary
    const sections: string[] = [];

    // 1. Name and Category
    sections.push(
      isKo
        ? `📍 **${facts.name}** (${facts.category || '관광지'})`
        : `📍 **${facts.name}** (${facts.category || '観光スポット'})`,
    );

    // 2. Overview / Description
    if (facts.overview) {
      sections.push(facts.overview);
    } else {
      sections.push(
        isKo
          ? '공식 데이터베이스에 등록된 상세 설명이 없습니다.'
          : '公式データベースに詳細な説明の登録がありません。',
      );
    }

    // 3. Location
    if (facts.roadAddress || facts.address) {
      sections.push(
        isKo
          ? `🏢 위치: ${facts.roadAddress || facts.address}`
          : `🏢 住所: ${facts.roadAddress || facts.address}`,
      );
    }

    // 4. Business hours (with strict grounding)
    if (facts.businessHours) {
      sections.push(
        isKo ? `⏰ 운영시간: ${facts.businessHours}` : `⏰ 営業時間: ${facts.businessHours}`,
      );
    } else if (webEvidence?.evidence.businessHours.status === 'sourced') {
      sections.push(
        isKo
          ? `🔎 웹 검색 근거 운영시간: ${webEvidence.evidence.businessHours.value}`
          : `🔎 ウェブ検索に基づく営業時間: ${webEvidence.evidence.businessHours.value}`,
      );
    } else {
      sections.push(
        isKo
          ? '⏰ 운영시간: 현재 연결된 공식 데이터에서는 영업시간을 확인할 수 없습니다. 방문 전 공식 채널 확인을 권장합니다.'
          : '⏰ 営業時間: 現在の公式データでは営業時間を確認できません。訪問前に最新情報をご確認ください。',
      );
    }

    // 5. Price / Budget (with strict grounding)
    if (
      facts.priceEvidence &&
      (facts.priceEvidence.minPrice != null || facts.priceEvidence.maxPrice != null)
    ) {
      const priceStr =
        facts.priceEvidence.minPrice === facts.priceEvidence.maxPrice
          ? `${facts.priceEvidence.minPrice?.toLocaleString()}원`
          : `${facts.priceEvidence.minPrice?.toLocaleString()}원 ~ ${facts.priceEvidence.maxPrice?.toLocaleString()}원`;
      sections.push(
        isKo
          ? `💰 가격 정보: ${priceStr} (${facts.priceEvidence.sourceTitle || '검증된 가격'})`
          : `💰 料金情報: 約${priceStr} (${facts.priceEvidence.sourceTitle || '確認済み価格'})`,
      );
    } else if (webEvidence?.evidence.price.status === 'sourced') {
      sections.push(
        isKo
          ? `🔎 웹 검색 근거 가격: ${webEvidence.evidence.price.value}`
          : `🔎 ウェブ検索に基づく料金: ${webEvidence.evidence.price.value}`,
      );
    } else {
      sections.push(
        isKo
          ? '💰 가격 정보: 현재 연결된 공식 데이터에서는 가격 정보를 확인할 수 없습니다.'
          : '💰 料金情報: 現在の公式データでは料金情報を確認できません。',
      );
    }

    // 6. Map / Detail Link
    if (facts.placeDetailLink) {
      sections.push(
        isKo
          ? `🔗 [카카오맵 상세 정보 보기](${facts.placeDetailLink.url})`
          : `🔗 [Kakaoマップ詳細情報を見る](${facts.placeDetailLink.url})`,
      );
    }

    if (webEvidence) {
      const fetchedAt = new Intl.DateTimeFormat(isKo ? 'ko-KR' : 'ja-JP', {
        timeZone: 'Asia/Seoul',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(webEvidence.fetchedAt));
      sections.push(
        isKo
          ? `🧾 웹 정보 확인 시각: ${fetchedAt}\n검색 결과는 변경될 수 있으므로 아래 출처를 방문 전에 다시 확인해 주세요.`
          : `🧾 ウェブ情報の確認日時: ${fetchedAt}\n検索結果は変更される可能性があるため、訪問前に下記の出典を再確認してください。`,
      );

      if (webEvidence.evidence.warnings.length > 0) {
        sections.push(
          `${isKo ? '⚠️ 주의' : '⚠️ 注意'}: ${webEvidence.evidence.warnings.join(' ')}`,
        );
      }
    }

    const responseMessage = sections.join('\n\n');

    return Promise.resolve({
      responseMessage,
      status: 'completed',
    });
  };
}
