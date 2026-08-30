import type { PlaceDetailEnrichmentGateway } from '../../place-details/place-detail-evidence.types';
import type { ChatState, ChatUpdate } from '../chat-state';

const DETAIL_QUERY_PATTERN =
  /영업|운영\s*시간|가격|가격대|메뉴|최신\s*정보|営業時間|営業日|料金|価格|メニュー|最新情報/i;

export function shouldEnrichPlaceDetails(state: ChatState): boolean {
  const message = state.messages[state.messages.length - 1];
  const text = typeof message?.content === 'string' ? message.content : '';
  if (!state.verifiedPlaceFacts || !DETAIL_QUERY_PATTERN.test(text)) return false;

  const asksHours = /영업|운영\s*시간|営業時間|営業日/i.test(text);
  const asksPrice = /가격|가격대|메뉴|料金|価格|メニュー/i.test(text);
  const asksLatest = /최신\s*정보|最新情報/i.test(text);
  return (
    asksLatest ||
    (asksHours && !state.verifiedPlaceFacts.businessHours) ||
    (asksPrice && !state.verifiedPlaceFacts.priceEvidence)
  );
}

export function createEnrichPlaceDetailsNode(
  enrichment?: PlaceDetailEnrichmentGateway,
): (state: ChatState) => Promise<ChatUpdate> {
  return async (state: ChatState): Promise<ChatUpdate> => {
    const facts = state.verifiedPlaceFacts;
    if (!facts || !enrichment || !shouldEnrichPlaceDetails(state)) return {};

    const message = state.messages[state.messages.length - 1];
    const userQuery = typeof message?.content === 'string' ? message.content : '';
    const webEvidence = await enrichment.enrich({
      placeId: facts.placeId,
      name: facts.sourceName,
      localizedName: facts.name,
      address: facts.address,
      roadAddress: facts.roadAddress,
      userQuery,
      locale: state.locale,
    });

    return {
      verifiedPlaceFacts: {
        ...facts,
        webEvidence,
      },
    };
  };
}
