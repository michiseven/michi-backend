export type IntentType = 'qa' | 'clarify' | 'create_trip' | 'modify_trip';

export interface ClassifiedIntent {
  intent: IntentType;
  placeNameQuery?: string;
  modification?: {
    action: 'remove' | 'replace';
    targetStopId?: string | null;
    targetStopOrder?: number;
    targetPlaceName?: string;
    replacementQuery?: string | null;
  };
  createTripInput?: {
    text: string;
    startArea?: string;
    travelDate?: string;
    startTime?: string;
    endTime?: string;
    budget?: number;
    airport?: string;
    hotel?: string;
  };
}

export function classifyIntentRuleBased(message: string, hasActiveTrip: boolean): ClassifiedIntent {
  const trimmed = message.trim();

  // 1. Check for Modification requests if active trip exists or explicit modification keywords
  const isModifyKeyword =
    /바꿔|교체|변경|빼줘|삭제|제외|바꿀래|変え|変更|削除|抜いて|別の|チェンジ/i.test(trimmed);

  if (
    isModifyKeyword &&
    (hasActiveTrip || /\d+\s*(?:번째|번|番目)|첫\s*번째|두\s*번째/.test(trimmed))
  ) {
    const isRemove = /빼줘|삭제|제외|抜いて|削除/.test(trimmed);
    const action: 'remove' | 'replace' = isRemove ? 'remove' : 'replace';

    // Extract order (e.g. 1번째, 2번째, 첫번째, 두번째, 1番目, 2番目, 1つ目, 2つ目)
    let targetStopOrder: number | undefined;
    const orderMatch = trimmed.match(/(\d+)\s*(?:번째|번|番目|つ目)/);
    if (orderMatch) {
      targetStopOrder = parseInt(orderMatch[1]!, 10);
    } else if (/첫\s*번째|1番目|1つ目/.test(trimmed)) {
      targetStopOrder = 1;
    } else if (/두\s*번째|2番目|2つ目/.test(trimmed)) {
      targetStopOrder = 2;
    } else if (/세\s*번째|3番目|3つ目/.test(trimmed)) {
      targetStopOrder = 3;
    } else if (/네\s*번째|4番目|4つ目/.test(trimmed)) {
      targetStopOrder = 4;
    }

    // Extract replacement query (e.g. "조용한 베이커리 카페로", "삼겹살 맛집으로")
    let replacementQuery: string | null = null;
    const repMatch = trimmed.match(
      /(?:다른|새로운|좋은)?\s*([가-힣a-zA-Z0-9\s]+?)(?:[으]로|[로]|に)\s*(?:바꿔|교체|변경|변환|変え|変更)/,
    );
    if (repMatch && repMatch[1]) {
      replacementQuery = repMatch[1].trim();
    }

    // Extract target place name if mentioned
    let targetPlaceName: string | undefined;
    const targetMatch = trimmed.match(
      /['"‘“]([^'"’“”]+)['"’”]|([가-힣a-zA-Z0-9]+)\s*(?:빼|삭제|제외|대신)/,
    );
    if (targetMatch) {
      targetPlaceName = (targetMatch[1] || targetMatch[2])?.trim();
    }

    return {
      intent: 'modify_trip',
      modification: {
        action,
        targetStopOrder,
        targetPlaceName,
        replacementQuery,
      },
    };
  }

  // 2. Check for QA / Explanation queries (questions about places, attractions, hours, prices, tips)
  const isQuestion =
    /\?|？|뭐|무엇|어떤|어때|어디|어떻게|설명|알려줘|몇\s*시|휴무|영업|가격|입장료|할수|할\s*수|何|どんな|どう|どこ|いつ|営業時間|料金|アクセス|教えて|見どころ/.test(
      trimmed,
    );

  if (isQuestion && !/일정\s*짜줘|코스\s*만들어줘|플랜\s*짜줘|プラン作って/.test(trimmed)) {
    let placeNameQuery: string | undefined;
    const placeMatch = trimmed.match(
      /(?:내가\s*)?([가-힣a-zA-Z0-9\s]+?)(?:에서|의|은|는|이|가|이란|란|という|で|の|は)\s*(?:뭐|무엇|어떤|어때|할\s*수|몇\s*시|휴무|영업|가격|입장료|설명|何|どんな|どう|教えて)/,
    );
    if (placeMatch && placeMatch[1]) {
      placeNameQuery = placeMatch[1].trim();
    } else {
      const quoted = trimmed.match(/['"‘“]([^'"’“”]+)['"’”]/);
      if (quoted && quoted[1]) {
        placeNameQuery = quoted[1].trim();
      }
    }

    return {
      intent: 'qa',
      placeNameQuery,
    };
  }

  // 3. Check for vague prompt
  const isVague =
    /^(서울\s*여행(\s*추천(해줘)?)?|서울\s*추천|추천해줘|어디\s*가지|놀러가|뭐하지|추천|소개해줘|おすすめ|ソウル旅行|どこ行けばいい|プラン作って|案内して|遊びに行きたい)$/i.test(
      trimmed,
    ) ||
    (!/(성수|명동|홍대|강남|을지로|동대문|잠실|여의도|안국|서촌|북촌|이태원|한남|聖水|明洞|弘大|江南|乙支路)/.test(
      trimmed,
    ) &&
      !hasActiveTrip &&
      trimmed.length < 8);

  if (isVague) {
    return { intent: 'clarify' };
  }

  // 4. Check for New Trip creation
  const isCreate =
    /일정|코스|플랜|여행|투어|가고\s*싶어|짜줘|만들어줘|계획|プラン|旅程|コース|行きたい|作って/.test(
      trimmed,
    ) ||
    /(성수|명동|홍대|강남|을지로|동대문|잠실|여의도|안국|서촌|북촌|이태원|한남|聖水|明洞|弘大|江南|乙支路)/.test(
      trimmed,
    );

  if (isCreate) {
    const areaMatch = trimmed.match(
      /성수|명동|홍대|강남|을지로|동대문|잠실|여의도|안국|서촌|북촌|이태원|한남|聖水|明洞|弘大|江南|乙支路/,
    );
    const budgetMatch = trimmed.match(/(\d+)\s*만\s*원/);
    const budget = budgetMatch ? parseInt(budgetMatch[1]!, 10) * 10000 : undefined;

    return {
      intent: 'create_trip',
      createTripInput: {
        text: trimmed,
        startArea: areaMatch ? areaMatch[0] : '성수',
        budget,
      },
    };
  }

  // Default fallback
  return { intent: hasActiveTrip ? 'qa' : 'clarify' };
}
