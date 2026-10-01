import type OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { createOpenAIPlaceSearchDecider } from './openai-place-search-decider';
import { runPlaceSearchAgent } from './place-search-agent-loop';

const context: Parameters<Parameters<typeof runPlaceSearchAgent>[1]>[0] = {
  request: { area: '공덕', role: 'cafe', query: '카페' },
  observations: [],
  searchesRemaining: 3,
  signal: new AbortController().signal,
};
const toolResponse = (name: string, args: unknown, callId = 'call-1'): object => ({
  output: [{ type: 'function_call', name, call_id: callId, arguments: JSON.stringify(args) }],
});

describe('OpenAI place search decisions', () => {
  it('returns a matching function_call_output to the next model request and preserves locale', async () => {
    const captured: ResponseInputItem[][] = [];
    const responses = [
      toolResponse('search_places', { query: '카페' }),
      toolResponse('ask_user', { question: 'どの地域ですか？' }, 'call-2'),
    ];
    const create = jest.fn((params: { input: ResponseInputItem[] }): Promise<object> => {
      captured.push(structuredClone(params.input));
      return Promise.resolve(responses.shift()!);
    });
    const decide = createOpenAIPlaceSearchDecider(
      { responses: { create } } as unknown as OpenAI,
      'configured-model',
      'ja',
    );
    expect(await decide(context)).toEqual({ action: 'search', query: '카페' });
    expect(
      await decide({
        ...context,
        observations: [{ query: '카페', status: 'empty', places: [] }],
        searchesRemaining: 2,
      }),
    ).toEqual({ action: 'ask', question: 'どの地域ですか？' });
    const firstInput = captured[0]![0] as { role: string; content: string };
    expect(firstInput.role).toBe('user');
    expect(firstInput.content).toContain('"locale":"ja"');
    expect(captured[1]).toContainEqual({
      type: 'function_call_output',
      call_id: 'call-1',
      output: JSON.stringify({
        observation: { query: '카페', status: 'empty', places: [] },
        searchesRemaining: 2,
      }),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        store: false,
        parallel_tool_calls: false,
        tool_choice: 'required',
        model: 'configured-model',
      }),
      expect.objectContaining({ maxRetries: 0, timeout: 15000, signal: context.signal }),
    );
  });
  it.each([
    toolResponse('search_places', { query: '카페', area: '부산' }),
    toolResponse('execute_sql', { query: 'DROP TABLE places' }),
    { output: [] },
    {
      output: [
        { type: 'function_call', name: 'search_places', call_id: 'x', arguments: 'not-json' },
      ],
    },
  ])('rejects invalid tool actions without executing anything', async (response) => {
    const create = jest.fn().mockResolvedValue(response);
    const decide = createOpenAIPlaceSearchDecider(
      { responses: { create } } as unknown as OpenAI,
      'configured-model',
    );
    await expect(decide(context)).rejects.toThrow();
  });
});
