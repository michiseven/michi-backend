import type { Repository } from 'typeorm';
import type { Place, Trip } from '../../database/entities';
import type { ChatState, ChatUpdate, VerifiedPlaceFacts } from '../chat-state';
import { verifiedPlacePrice } from '../../providers/place/place-price-evidence';
import { localizePlaceName } from '../../trips/place-name-localizer';

function normalizedName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function stripKoreanParticle(value: string): string {
  return value.replace(
    /(에서|으로|에게|부터|까지|처럼|보다|은|는|이|가|을|를|의|에|와|과|도|로)$/u,
    '',
  );
}

export function placeQueryPhrases(text: string): string[] {
  const stopWords =
    /^(내가|어디|어떤|어때|추천|설명|알려줘|뭐야|무엇|있는|진짜|혹시|최신|정보|영업시간|운영시간|가격|가격대|메뉴|출처|함께|営業時間|料金|価格|メニュー|最新情報)$/iu;
  const words = text
    .normalize('NFKC')
    .replace(/[?.,!~'"‘’“”()[\]{}]/g, ' ')
    .split(/\s+/)
    .map(stripKoreanParticle)
    .filter((word) => word.length >= 2 && !stopWords.test(word));

  const phrases: string[] = [];
  const maxWindow = Math.min(words.length, 5);
  for (let size = maxWindow; size >= 1; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      phrases.push(words.slice(start, start + size).join(' '));
    }
  }
  return [...new Set(phrases)];
}

export function createLoadVerifiedFactsNode(
  placesRepo: Repository<Place>,
  tripsRepo: Repository<Trip>,
) {
  return async (state: ChatState): Promise<ChatUpdate> => {
    const lastMsg = state.messages[state.messages.length - 1];
    const text = typeof lastMsg?.content === 'string' ? lastMsg.content : '';

    let matchedPlace: Place | null = null;

    // 1. Try finding place within current trip if trip ID is available
    if (state.currentTripId) {
      const trip = await tripsRepo.findOne({
        where: { id: state.currentTripId },
        relations: ['stops', 'stops.place'],
      });
      if (trip && trip.stops) {
        const normalizedText = normalizedName(text);
        const matches = trip.stops
          .flatMap((stop) => {
            if (!stop.place?.name) return [];
            const names = [stop.place.name, localizePlaceName(stop.place.name, state.locale)];
            return names.map((name) => ({
              place: stop.place,
              normalized: normalizedName(name),
            }));
          })
          .filter(
            (candidate) =>
              candidate.normalized.length >= 2 && normalizedText.includes(candidate.normalized),
          )
          .sort((left, right) => right.normalized.length - left.normalized.length);

        matchedPlace = matches[0]?.place ?? null;
      }
    }

    // 2. If not found in current trip, search Place DB by name substring
    if (!matchedPlace) {
      // 긴 고유명사 구절부터 검색한다. 지역명 한 단어가 먼저 매칭되어 다른
      // 장소를 선택하는 일을 막기 위해 단일 단어는 마지막에만 사용한다.
      for (const phrase of placeQueryPhrases(text)) {
        const found = await placesRepo
          .createQueryBuilder('p')
          .where('p.name ILIKE :name', { name: `%${phrase}%` })
          .take(1)
          .getOne();
        if (found) {
          matchedPlace = found;
          break;
        }
      }
    }

    if (!matchedPlace) {
      return {
        verifiedPlaceFacts: null,
      };
    }

    const priceInfo = verifiedPlacePrice(matchedPlace.estimatedCostKrw, matchedPlace.priceEvidence);
    const rawOverview = (matchedPlace.rawPayload?.overview ||
      matchedPlace.rawPayload?.description ||
      matchedPlace.rawPayload?.summary ||
      '') as string;
    const cleanOverview = rawOverview.replace(/<[^>]+>/g, '').trim();

    let placeDetailLink: { provider: 'kakao-map'; url: string } | null = null;
    const rawUrl = (matchedPlace.rawPayload?.place_url ||
      matchedPlace.rawPayload?.sourceUrl) as string;
    if (rawUrl && rawUrl.startsWith('http')) {
      placeDetailLink = { provider: 'kakao-map', url: rawUrl };
    }

    const facts: VerifiedPlaceFacts = {
      placeId: matchedPlace.id,
      name: localizePlaceName(matchedPlace.name, state.locale),
      sourceName: matchedPlace.name,
      category: matchedPlace.category || matchedPlace.rawCategory || null,
      address: matchedPlace.address || null,
      roadAddress: matchedPlace.roadAddress || null,
      overview: cleanOverview || null,
      businessHours: (matchedPlace.rawPayload?.businessHours ||
        matchedPlace.rawPayload?.openingHours ||
        null) as string | null,
      priceEvidence: priceInfo?.priceEvidence
        ? {
            minPrice: priceInfo.priceEvidence.minPriceKrw ?? null,
            maxPrice: priceInfo.priceEvidence.maxPriceKrw ?? null,
            sourceTitle: priceInfo.priceEvidence.sourceTitle ?? null,
            sourceUrl: priceInfo.priceEvidence.sourceUrl ?? null,
          }
        : null,
      crowdContext: null,
      placeDetailLink,
      source: matchedPlace.source,
      sourcePlaceId: matchedPlace.sourcePlaceId || null,
      webEvidence: null,
    };

    return {
      verifiedPlaceFacts: facts,
    };
  };
}
