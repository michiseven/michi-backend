import { Injectable } from '@nestjs/common';
import type { CrowdObservation, CrowdProvider } from './crowd-provider';

@Injectable()
export class MockCrowdProvider implements CrowdProvider {
  readonly mode = 'mock' as const;
  readonly name = 'mock-crowd';

  getAreaCrowd(areaName: string): Promise<CrowdObservation> {
    return Promise.resolve({
      provider: this.name,
      providerMode: this.mode,
      scope: 'area',
      areaName,
      areaCode: null,
      congestionLevel: 'MOCK_NORMAL',
      congestionMessage: '開発用の架空の地域混雑データです。',
      observedAt: null,
      disclaimer:
        'MOCK 데이터입니다. 지역 단위 예시이며 특정 장소 내부의 혼잡도를 의미하지 않습니다.',
      sourceUrl: null,
      rawPayload: { fixture: true, synthetic: true, scope: 'area', areaName },
    });
  }
}
