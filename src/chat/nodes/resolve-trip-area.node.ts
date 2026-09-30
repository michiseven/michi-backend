import type { Repository } from 'typeorm';
import type { Place } from '../../database/entities';
import { normalizeSeoulArea } from '../../preferences/seoul-area-normalizer';
import { knownSeoulSearchArea } from '../../providers/place/seoul-area-centers';
import type { ChatState, ChatUpdate } from '../chat-state';

/** Model output supplies names only. Coordinates and boundaries come from our data. */
export function createResolveTripAreaNode(places: Repository<Place>) {
  return async (state: ChatState): Promise<ChatUpdate> => {
    const input = state.createTripInput;
    if (!input?.startArea) return {};
    let area: string | null = null;
    try {
      area = normalizeSeoulArea(input.startArea);
    } catch {
      // An unsupported name becomes one specific question, not a generic reset.
    }
    const known = area && knownSeoulSearchArea(area);
    if (!known && area) {
      const rows = await places.query<Array<{ name: string }>>(
        `SELECT name FROM seoul_spatial_areas
         WHERE area_kind = 'administrative_dong'
           AND (name = $1 OR aliases @> $2::jsonb)
         ORDER BY name LIMIT 2`,
        [area, JSON.stringify([area])],
      );
      if (rows.length === 1) area = rows[0]!.name;
      else area = null;
    }
    if (area) return { createTripInput: { ...input, startArea: area } };
    return {
      intent: 'clarify',
      clarificationKind: 'general',
      clarificationQuestion:
        state.locale === 'ko'
          ? `요청하신 지역을 서울 지역 데이터에서 하나로 확인하지 못했어요. 방문하려는 동네나 가까운 역 이름을 알려주시겠어요?`
          : 'ご希望のエリアをソウルの地域データで特定できませんでした。訪れたい街や最寄り駅の名前を教えていただけますか？',
      pendingCreateTripInput: input,
      pendingQuestion: null,
    };
  };
}
