import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { DeterministicItineraryExplanationProvider } from './deterministic-itinerary-explanation.provider';
import { OpenAIItineraryExplanationProvider } from './openai-itinerary-explanation.provider';
import type { ItineraryExplanationInput } from './itinerary-explanation.types';

describe('OpenAIItineraryExplanationProvider', () => {
  const fallback = new DeterministicItineraryExplanationProvider();

  const sampleInput: ItineraryExplanationInput = {
    locale: 'ko',
    preference: {
      area: '서촌',
      totalDays: 1,
      startTime: '11:00',
      endTime: '19:00',
      interests: ['cafe'],
      preferences: ['quiet'],
      avoid: [],
    },
    stops: [
      {
        order: 1,
        dayNumber: 1,
        placeId: 'place-1',
        placeName: '서촌 한옥 카페',
        category: 'cafe',
        district: '종로구',
        stopType: 'general',
        arrivalAt: '11:00',
        leaveAt: '12:30',
        estimatedStayMinutes: 90,
        estimatedCost: 10000,
        reason: '한옥 분위기의 카페',
        scoreBreakdown: { total: 0.9 },
        inboundRoute: null,
        nextLegRoute: {
          durationMinutes: 10,
          distanceKm: 0.5,
          transportMode: 'walk',
          evidence: 'estimated',
        },
      },
      {
        order: 2,
        dayNumber: 1,
        placeId: 'place-2',
        placeName: '서촌 갤러리',
        category: 'museum',
        district: '종로구',
        stopType: 'general',
        arrivalAt: '12:40',
        leaveAt: '14:00',
        estimatedStayMinutes: 80,
        estimatedCost: 15000,
        reason: '서촌 대표 갤러리',
        scoreBreakdown: { total: 0.85 },
        inboundRoute: {
          durationMinutes: 10,
          distanceKm: 0.5,
          transportMode: 'walk',
          evidence: 'estimated',
        },
        nextLegRoute: null,
      },
    ],
  };

  function createProvider(
    mode: 'mock' | 'live',
    mockParse?: (req: unknown) => Promise<{ output_parsed: unknown }>,
  ): OpenAIItineraryExplanationProvider {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'LLM_PROVIDER_MODE') return mode;
        if (key === 'OPENAI_MODEL') return 'gpt-5.6-luna';
        return undefined;
      }),
    } as unknown as ConfigService;

    const client =
      mode === 'live'
        ? ({
            responses: {
              parse: mockParse ?? jest.fn(),
            },
          } as unknown as OpenAI)
        : null;

    return new OpenAIItineraryExplanationProvider(client, config, fallback);
  }

  it('delegates to deterministic provider when LLM_PROVIDER_MODE is mock', async () => {
    const provider = createProvider('mock');
    const result = await provider.generate(sampleInput);

    expect(result.mode).toBe('mock');
    expect(result.tripSummary).toContain('서촌');
    expect(result.stops).toHaveLength(2);
    expect(result.stops[0]!.previousStopFit).toBeNull();
    expect(result.stops[1]!.nextStopFit).toBeNull();
  });

  it('calls OpenAI responses.parse exactly once and validates matching stops and boundary nulls', async () => {
    const parseMock = jest.fn().mockResolvedValue({
      output_parsed: {
        tripSummary: '서촌의 고즈넉한 분위기를 즐길 수 있는 1일 여행 코스입니다.',
        stops: [
          {
            order: 1,
            placeId: 'place-1',
            shortDescription: '서촌 한옥 카페는 종로구에 위치한 전통 한옥 카페입니다.',
            previousStopFit: '잘못된 이전 설명', // Must be sanitized to null by provider for first stop
            nextStopFit: '도보 10분 거리의 서촌 갤러리로 자연스럽게 이동할 수 있습니다.',
            overallTripFit: '조용한 분위기를 선호하는 여행자에게 최적인 출발점입니다.',
          },
          {
            order: 2,
            placeId: 'place-2',
            shortDescription: '서촌 갤러리는 지역 예술가들의 현대 미술을 전시하는 공간입니다.',
            previousStopFit: '카페 방문 후 여유롭게 문화 예술을 감상하기 좋습니다.',
            nextStopFit: '잘못된 다음 설명', // Must be sanitized to null by provider for last stop
            overallTripFit: '취향에 맞는 예술 전시를 감상할 수 있습니다.',
          },
        ],
      },
    });

    const provider = createProvider('live', parseMock);
    const result = await provider.generate(sampleInput);

    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('live');
    expect(result.tripSummary).toBe('서촌의 고즈넉한 분위기를 즐길 수 있는 1일 여행 코스입니다.');
    expect(result.stops[0]!.previousStopFit).toBeNull(); // sanitized
    expect(result.stops[1]!.nextStopFit).toBeNull(); // sanitized
    expect(result.stops[0]!.nextStopFit).toContain('서촌 갤러리');
  });

  it('falls back to deterministic explanation if OpenAI call fails', async () => {
    const parseMock = jest.fn().mockRejectedValue(new Error('OpenAI 500 error'));
    const provider = createProvider('live', parseMock);

    const result = await provider.generate(sampleInput);

    expect(result.mode).toBe('fallback');
    expect(result.stops).toHaveLength(2);
    expect(result.stops[0]!.placeId).toBe('place-1');
  });

  it('passes complete facts payload including scoreBreakdown and tourism evidence to OpenAI', async () => {
    let capturedPayload: unknown = null;
    const parseMock = jest.fn().mockImplementation((req: { input: Array<{ content: string }> }) => {
      const userContent = req.input.find((m) =>
        m.content.startsWith('Generate contextual explanations'),
      );
      if (userContent) {
        const jsonStr = userContent.content.replace(
          /^Generate contextual explanations for this Seoul itinerary:\n/u,
          '',
        );
        capturedPayload = JSON.parse(jsonStr);
      }
      return Promise.resolve({
        output_parsed: {
          tripSummary: '서촌 1일 일정 요약입니다.',
          stops: [
            {
              order: 1,
              placeId: 'place-1',
              shortDescription: '서촌 한옥 카페는 종로구 카페입니다.',
              previousStopFit: null,
              nextStopFit: '도보로 서촌 갤러리로 이동합니다.',
              overallTripFit: '취향에 적합합니다.',
            },
            {
              order: 2,
              placeId: 'place-2',
              shortDescription: '서촌 갤러리는 종로구 미술관입니다.',
              previousStopFit: '카페 이후 방문합니다.',
              nextStopFit: null,
              overallTripFit: '일정에 적합합니다.',
            },
          ],
        },
      });
    });

    const inputWithTourism: ItineraryExplanationInput = {
      ...sampleInput,
      stops: [
        {
          ...sampleInput.stops[0]!,
          scoreBreakdown: { preference: 0.9, distance: 0.8 },
          tourismEvidence: {
            concentration: { level: 'low', referencePeriod: '2026-08', areaName: '종로구' },
            sourceRef: 'KTO_DATALAB_2026',
          },
        },
        sampleInput.stops[1]!,
      ],
    };

    const provider = createProvider('live', parseMock);
    const result = await provider.generate(inputWithTourism);

    expect(result.mode).toBe('live');
    expect(capturedPayload).toBeDefined();
    const payload = capturedPayload as {
      stops: Array<{ scoreBreakdown?: unknown; tourismEvidence?: unknown }>;
    };
    expect(payload.stops[0]?.scoreBreakdown).toEqual({ preference: 0.9, distance: 0.8 });
    expect(payload.stops[0]?.tourismEvidence).toEqual({
      concentration: { level: 'low', referencePeriod: '2026-08', areaName: '종로구' },
      sourceRef: 'KTO_DATALAB_2026',
    });
  });

  it('falls back to deterministic explanation if OpenAI reorders or returns wrong placeId', async () => {
    const parseMock = jest.fn().mockResolvedValue({
      output_parsed: {
        tripSummary: '순서가 바뀐 설명',
        stops: [
          {
            order: 1,
            placeId: 'place-2', // wrong placeId for order 1
            shortDescription: '순서 오류 장소 2',
            previousStopFit: null,
            nextStopFit: null,
            overallTripFit: '부적합',
          },
          {
            order: 2,
            placeId: 'place-1',
            shortDescription: '순서 오류 장소 1',
            previousStopFit: null,
            nextStopFit: null,
            overallTripFit: '부적합',
          },
        ],
      },
    });

    const provider = createProvider('live', parseMock);
    const result = await provider.generate(sampleInput);

    expect(result.mode).toBe('fallback');
    expect(result.stops[0]!.placeId).toBe('place-1');
    expect(result.stops[1]!.placeId).toBe('place-2');
  });
});
