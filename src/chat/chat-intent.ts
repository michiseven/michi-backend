export type IntentType = 'qa' | 'clarify' | 'create_trip' | 'modify_trip';

export interface ClassifiedIntent {
  intent: IntentType;
  clarificationQuestion?: string | null;
  clarificationKind?: 'meal' | 'general' | null;
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
    partySize?: number;
    budgetScope?: 'total' | 'per_person';
    companions?: 'solo' | 'couple' | 'friends' | 'family' | 'with_children';
    pace?: 'relaxed' | 'standard' | 'packed';
    safetyConstraints?: import('../trips/safety-constraints').SafetyConstraintKind[];
    hasLuggage?: boolean;
  };
}

/**
 * Extract only a region the user explicitly wrote. This is deliberately
 * narrower than the preference parser's inferred area: an LLM may suggest a
 * nearby area, but it must not replace a region stated by the user.
 */
export function extractExplicitSeoulArea(message: string): string | undefined {
  const aliases = [
    ['성수동', '성수'],
    ['弘大', '홍대'],
    ['홍익대', '홍대'],
    ['聖水', '성수'],
    ['江南', '강남'],
    ['明洞', '명동'],
    ['梨泰院', '이태원'],
    ['鍾路', '종로'],
    ['鐘路', '종로'],
    ['東大門', '동대문'],
    ['蚕室', '잠실'],
    ['北村', '북촌'],
    ['梨大', '이대'],
    ['延南', '연남'],
    ['益善洞', '익선동'],
    ['汝矣島', '여의도'],
    ['ソウルの森', '서울숲'],
    ['孔徳', '공덕'],
    ['공덕동', '공덕'],
    ['麻浦', '마포'],
    ['마포구', '마포'],
    ['漢南', '한남'],
    ['한남동', '한남'],
    ['乙支路', '을지로'],
    ['城北', '성북'],
    ['성북동', '성북'],
    ['三清洞', '삼청동'],
    ['삼청', '삼청동'],
    ['西村', '서촌'],
    ['文来', '문래'],
    ['문래동', '문래'],
    ['望遠', '망원'],
    ['망원동', '망원'],
    ['仁寺洞', '인사동'],
    ['カロスキル', '가로수길'],
    ['狎鴎亭洞', '압구정'],
    ['狎鴎亭', '압구정'],
    ['清潭洞', '청담'],
    ['清潭', '청담'],
    ['성수', '성수'],
    ['명동', '명동'],
    ['홍대', '홍대'],
    ['강남', '강남'],
    ['을지로', '을지로'],
    ['동대문', '동대문'],
    ['잠실', '잠실'],
    ['여의도', '여의도'],
    ['안국', '안국'],
    ['서촌', '서촌'],
    ['북촌', '북촌'],
    ['이태원', '이태원'],
    ['한남', '한남'],
  ] as const;
  const ordered = [...aliases].sort((left, right) => right[0].length - left[0].length);
  const hits = ordered
    .map(([value, area]) => ({ value, area, index: message.indexOf(value) }))
    .filter((hit) => hit.index >= 0)
    .sort((left, right) => left.index - right.index || right.value.length - left.value.length)
    .filter((hit, index, all) => index === 0 || hit.index !== all[index - 1]!.index);
  if (hits.length === 0) return undefined;

  const activeHits = hits.filter((hit) => {
    const hitIndex = hits.indexOf(hit);
    const nextHit = hits[hitIndex + 1];
    const between = message.slice(hit.index + hit.value.length, nextHit?.index ?? message.length);
    return !/(?:말고|아니라|대신|ではなく|じゃなく)/u.test(between);
  });
  const positiveHits = activeHits.filter((hit) => {
    const after = message.slice(hit.index + hit.value.length);
    return /^\s*(?:에서|으로|로|에|의|で|に)/u.test(after);
  });

  // Prefer the area attached to a location particle ("홍대에서"), ignore an
  // explicitly rejected alternative ("성수 말고"), and refuse to invent a
  // winner when multiple areas remain genuinely ambiguous.
  if (positiveHits.length > 0) return positiveHits[positiveHits.length - 1]!.area;
  if (activeHits.length === 1) return activeHits[0]!.area;
  return undefined;
}

/** Structured meal choices and their natural-language equivalents converge to
 * the same state transition in the chat node. */
export function extractMealCuisine(
  message: string,
): 'korean' | 'japanese' | 'chinese' | 'western' | 'cafe_dessert' | undefined {
  if (/한식|한국料理|韓国料理|韓国食|korean/iu.test(message)) return 'korean';
  if (/일식|日本料理|和食|japanese/iu.test(message)) return 'japanese';
  if (/중식|中華料理|chinese/iu.test(message)) return 'chinese';
  if (/양식|洋食|western/iu.test(message)) return 'western';
  if (
    /카페\s*[·ㆍ&와과및]?\s*디저트|카페와\s*디저트|カフェ.*スイーツ|cafe.*dessert/iu.test(message)
  ) {
    return 'cafe_dessert';
  }
  return undefined;
}

export function delegatesMealChoice(message: string): boolean {
  return /아무거나|상관없|네가\s*(골라|추천)|추천해\s*줘|지역.*(유명|대표|특색)|로컬.*(메뉴|맛집)|おまかせ|任せ|名物|人気.*(料理|グルメ)/iu.test(
    message,
  );
}

export function requiresMealClarification(message: string): boolean {
  const asksForMeal =
    /점심|저녁|식사|맛집|ランチ|昼食|夕食|食事|グルメ|食べ|lunch|dinner|meal|food/iu.test(message);
  if (!asksForMeal) return false;

  const hasExplicitMealType =
    /한식|일식|중식|양식|고기|韓国料理|日本料理|中華料理|洋食|焼肉|korean|japanese|chinese|western|meat/iu.test(
      message,
    );
  return !hasExplicitMealType && !delegatesMealChoice(message);
}

function toClock(hour: string, minute?: string, afternoon = false): string | undefined {
  const parsedHour = Number(hour);
  const parsedMinute = minute ? Number(minute) : 0;
  if (!Number.isInteger(parsedHour) || parsedHour < 0 || parsedHour > 23) return undefined;
  if (!Number.isInteger(parsedMinute) || parsedMinute < 0 || parsedMinute > 59) return undefined;
  const normalizedHour = afternoon && parsedHour < 12 ? parsedHour + 12 : parsedHour;
  if (normalizedHour > 23) return undefined;
  return `${String(normalizedHour).padStart(2, '0')}:${String(parsedMinute).padStart(2, '0')}`;
}

/** Extract only an explicit follow-up time window; omitted values stay intact. */
export function extractExplicitTimeWindow(message: string): {
  startTime?: string;
  endTime?: string;
} {
  const afternoon = /오후|午後|pm/i.test(message);
  const range = message.match(
    /(\d{1,2})(?::(\d{2}))?\s*(?:시|時)?\s*(?:부터|から|~|～|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*(?:시|時)?/u,
  );
  if (range) {
    return {
      startTime: toClock(range[1]!, range[2], afternoon),
      endTime: toClock(range[3]!, range[4], afternoon),
    };
  }

  const endOnly = message.match(
    /(?:오후|午後)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:시|時)?\s*(?:까지|まで)/u,
  );
  if (endOnly) {
    return { endTime: toClock(endOnly[1]!, endOnly[2], afternoon) };
  }
  return {};
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
    /일정|코스|플랜|여행|투어|가고\s*싶어|짜줘|만들어줘|계획|プラン|旅程|コース|行きたい|作って|散歩|歩き|カフェ|食べ|グルメ|楽し|巡り/.test(
      trimmed,
    ) ||
    /(성수|명동|홍대|강남|을지로|동대문|잠실|여의도|안국|서촌|북촌|이태원|한남|聖水|明洞|弘大|江南|乙支路)/.test(
      trimmed,
    );

  if (isCreate) {
    const explicitArea = extractExplicitSeoulArea(trimmed);
    const budgetMatch = trimmed.match(/(\d+)\s*만\s*원/);
    const budget = budgetMatch ? parseInt(budgetMatch[1]!, 10) * 10000 : undefined;
    // Keep an omitted area omitted. The preference parser owns product
    // defaults; chat classification must not silently turn it into 성수.
    if (requiresMealClarification(trimmed)) {
      return {
        intent: 'clarify',
        clarificationKind: 'meal',
        createTripInput: {
          text: trimmed,
          startArea: explicitArea,
          budget,
        },
      };
    }

    return {
      intent: 'create_trip',
      createTripInput: {
        text: trimmed,
        startArea: explicitArea,
        budget,
      },
    };
  }

  // Default fallback
  return { intent: hasActiveTrip ? 'qa' : 'clarify' };
}
