import type { ChatState, ChatUpdate } from '../chat-state';
import { isNorthKoreaRelated } from '../../common/utils/security-filter.util';

export function createValidateInputNode() {
  return (state: ChatState): Promise<ChatUpdate> => {
    const lastMsg = state.messages[state.messages.length - 1];
    const text = typeof lastMsg?.content === 'string' ? lastMsg.content : '';

    if (!text.trim()) {
      return Promise.resolve({
        responseMessage:
          state.locale === 'ko' ? '메시지를 입력해 주세요.' : 'メッセージを入力してください。',
        status: 'completed',
        intent: 'clarify',
      });
    }

    const isNorthKorea =
      isNorthKoreaRelated(text) ||
      (/북한|조선민주주의|DPRK|North\s*Korea|DMZ|판문점|땅굴|도라산|통일전망대|임진각|탈북|간첩/i.test(
        text,
      ) &&
        !/북한산/.test(text));

    if (isNorthKorea) {
      return Promise.resolve({
        responseMessage:
          state.locale === 'ko'
            ? 'Michi는 서울 도심 및 로컬 상권 여행 전문 서비스입니다. 북한 및 DMZ 관련 일정은 제공하지 않으며, 성수·한남·홍대·명동 등 서울 시내의 매력적인 관광지와 미식 일정을 추천해 드릴 수 있습니다! 서울 내 어떤 지역을 방문하고 싶으신가요?'
            : 'Michiはソウル都心・ローカル観光に特化したサービスです。北朝鮮やDMZ関連の旅程は扱っておりません。聖水・漢南・弘大・明洞などソウル市内の魅力的なスポットをご案内いたします！',
        status: 'completed',
        intent: 'qa',
      });
    }

    return Promise.resolve({});
  };
}
