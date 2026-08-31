import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemorySaver, Command, type BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { HumanMessage } from '@langchain/core/messages';
import { randomBytes } from 'crypto';
import { ChatThread, Place, Trip } from '../database/entities';
import { TripsService } from '../trips/trips.service';
import { createChatGraph } from './chat-graph';
import type { ChatState, ResumePayload } from './chat-state';
import type { CreateThreadDto } from './dto/create-thread.dto';
import type { SendMessageDto } from './dto/send-message.dto';
import type { ResumeThreadDto } from './dto/resume-thread.dto';
import type { ChatResponseDto, CreateThreadResponseDto } from './dto/chat-response.dto';
import { PlaceDetailEnrichmentService } from '../place-details/place-detail-enrichment.service';
import { LogEvent, LogField } from '@logfriends/sdk';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function formTripContext(profile: SendMessageDto['profile']): {
  arrivalDate?: string;
  arrivalTime?: string;
  departureDate?: string;
  departureTime?: string;
  hotel?: string;
} | null {
  if (!profile) return null;

  const arrivalDate = DATE_PATTERN.test(profile.arrivalDate ?? '')
    ? profile.arrivalDate
    : undefined;
  const departureDate = DATE_PATTERN.test(profile.departureDate ?? '')
    ? profile.departureDate
    : undefined;
  const arrivalTime = TIME_PATTERN.test(profile.arrivalTime ?? '')
    ? profile.arrivalTime
    : undefined;
  const departureTime = TIME_PATTERN.test(profile.departureTime ?? '')
    ? profile.departureTime
    : undefined;

  // 역전된 날짜는 신뢰하지 않고 비운다. UI의 min 속성은 보조 수단일 뿐 서버 검증을 대신하지 않는다.
  if (arrivalDate && departureDate && departureDate < arrivalDate) return null;

  return {
    arrivalDate,
    arrivalTime,
    departureDate,
    departureTime,
    hotel: profile.hotel?.name?.slice(0, 120),
  };
}

@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);
  private checkpointer!: BaseCheckpointSaver;
  private graph!: ReturnType<typeof createChatGraph>;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Place)
    private readonly placesRepo: Repository<Place>,
    @InjectRepository(Trip)
    private readonly tripsRepo: Repository<Trip>,
    @InjectRepository(ChatThread)
    private readonly threadsRepo: Repository<ChatThread>,
    private readonly tripsService: TripsService,
    private readonly placeDetailEnrichment: PlaceDetailEnrichmentService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initGraph();
  }

  async initGraph(customCheckpointer?: BaseCheckpointSaver): Promise<void> {
    if (customCheckpointer) {
      this.checkpointer = customCheckpointer;
    } else {
      const mode = this.config.get<string>('CHAT_CHECKPOINTER_MODE') || 'memory';
      const dbUrl = this.config.get<string>('DATABASE_URL');

      if (mode === 'postgres' && dbUrl) {
        try {
          this.logger.log('Initializing PostgresSaver for LangGraph checkpoints...');
          const pgSaver = PostgresSaver.fromConnString(dbUrl);
          await pgSaver.setup();
          this.checkpointer = pgSaver;
          this.logger.log('PostgresSaver initialized successfully.');
        } catch (err) {
          this.logger.error('Failed to setup PostgresSaver, falling back to MemorySaver', err);
          this.checkpointer = new MemorySaver();
        }
      } else {
        this.logger.log('Using MemorySaver for LangGraph checkpoints.');
        this.checkpointer = new MemorySaver();
      }
    }

    const openaiApiKey = this.config.get<string>('OPENAI_API_KEY');

    this.graph = createChatGraph({
      placesRepo: this.placesRepo,
      tripsRepo: this.tripsRepo,
      tripsService: this.tripsService,
      openaiApiKey,
      placeDetailEnrichment: this.placeDetailEnrichment,
      checkpointer: this.checkpointer,
    });
  }

  async createThread(
    dto?: CreateThreadDto,
    userId?: string | null,
  ): Promise<CreateThreadResponseDto> {
    const threadSecret = randomBytes(32).toString('hex');
    const thread = this.threadsRepo.create({
      userId: userId || null,
      tripId: dto?.currentTripId || null,
      locale: dto?.locale || 'ja',
      threadSecret,
    });

    const saved = await this.threadsRepo.save(thread);
    return {
      threadId: saved.id,
      threadSecret: saved.threadSecret,
    };
  }

  async validateThreadAccess(
    threadId: string,
    caller: { userId?: string | null; threadSecret?: string | null },
  ): Promise<ChatThread> {
    const thread = await this.threadsRepo.findOne({ where: { id: threadId } });
    if (!thread) {
      throw new NotFoundException({
        code: 'THREAD_NOT_FOUND',
        message: 'Thread not found',
      });
    }

    // Ownership Verification
    if (thread.userId) {
      const isOwner = caller.userId && caller.userId === thread.userId;
      const hasSecret = caller.threadSecret && caller.threadSecret === thread.threadSecret;
      if (!isOwner && !hasSecret) {
        throw new ForbiddenException({
          code: 'THREAD_FORBIDDEN',
          message: 'Access to this chat thread is forbidden.',
        });
      }
    } else {
      // Anonymous Thread requires valid threadSecret
      const hasSecret = caller.threadSecret && caller.threadSecret === thread.threadSecret;
      if (!hasSecret) {
        throw new ForbiddenException({
          code: 'THREAD_FORBIDDEN',
          message: 'Access to this chat thread is forbidden.',
        });
      }
    }

    return thread;
  }

  @LogEvent({
    name: 'chatMessageProcessed',
    description: 'LangGraph 대화 상태형 워크플로 실행',
    apiMethod: 'POST',
    apiPath: '/chat/threads/{threadId}/messages',
    apiDescription: '대화 메시지 전송',
    includeResult: false,
    includeDuration: true,
    includeArgs: false,
    fields: [
      { name: 'threadId', description: '대화 스레드 식별자', type: 'string' },
      { name: 'messageLength', description: '메시지 길이', type: 'number' },
      { name: 'locale', description: '요청 언어', type: 'string', required: false },
      { name: 'hasActiveTrip', description: '활성 일정 연결 여부', type: 'boolean' },
      { name: 'hasProfile', description: '여행 프로필 입력 여부', type: 'boolean' },
    ],
    payload: (args) => {
      const dto = args[1] as SendMessageDto;
      return {
        threadId: args[0],
        messageLength: dto?.message?.length ?? 0,
        locale: dto?.locale,
        hasActiveTrip: Boolean(dto?.currentTripId),
        hasProfile: Boolean(dto?.profile),
      };
    },
  })
  async sendMessage(
    @LogField({ name: 'threadId', description: '대화 스레드 ID' })
    threadId: string,
    @LogField({ name: 'dto', description: '사용자 메시지 및 프로필' })
    dto: SendMessageDto,
    caller?: { userId?: string | null; threadSecret?: string | null; editToken?: string | null },
  ): Promise<ChatResponseDto> {
    const thread = await this.validateThreadAccess(threadId, {
      userId: caller?.userId,
      threadSecret: caller?.threadSecret || dto.threadSecret,
    });

    const editToken = caller?.editToken || dto.editToken || undefined;
    const config = {
      configurable: {
        thread_id: threadId,
        editToken,
        userId: thread.userId || caller?.userId || undefined,
      },
    };

    const previousSnapshot = await this.graph.getState({
      configurable: { thread_id: threadId },
    });
    if (
      (previousSnapshot.values as Partial<ChatState> | undefined)?.status ===
      'awaiting_confirmation'
    ) {
      throw new ConflictException({
        code: 'THREAD_AWAITING_CONFIRMATION',
        message: 'Approve or reject the pending trip change before sending another message.',
      });
    }

    const locale = dto.locale || (thread.locale as 'ko' | 'ja') || 'ja';

    const input = {
      messages: [new HumanMessage(dto.message)],
      locale,
      currentTripId: dto.currentTripId || thread.tripId || null,
      // 아래 값은 한 번의 사용자 턴에만 유효하다. 이전 checkpoint 값을 명시적으로
      // 비우지 않으면 validate_input이 과거 응답을 현재 응답으로 오인한다.
      intent: null,
      modification: null,
      createTripInput: null,
      formTripContext: formTripContext(dto.profile),
      verifiedPlaceFacts: null,
      alternatives: [],
      pendingAction: null,
      responseMessage: null,
      actionChips: [],
      resultTripId: null,
      resultTrip: null,
      status: 'completed' as const,
      errorCode: null,
    };

    const resultState = (await this.graph.invoke(input, config)) as unknown as ChatState;

    let issuedEditToken: string | undefined;
    if (resultState.intent === 'create_trip' && resultState.resultTripId) {
      const generatedTrip = await this.tripsRepo.findOne({
        where: { id: resultState.resultTripId },
      });
      issuedEditToken = generatedTrip?.editToken || undefined;

      // 다음 턴에서 currentTripId를 다시 보내지 않아도 같은 일정을 대화 대상으로 사용한다.
      if (thread.tripId !== resultState.resultTripId) {
        thread.tripId = resultState.resultTripId;
        await this.threadsRepo.save(thread);
      }
    }

    return this.mapStateToResponse(threadId, resultState, thread.threadSecret, issuedEditToken);
  }

  @LogEvent({
    name: 'chatResumeExecuted',
    description: 'Human-in-the-loop 변경 승인/재개 실행',
    apiMethod: 'POST',
    apiPath: '/chat/threads/{threadId}/resume',
    apiDescription: '대화 수정 재개',
    includeResult: false,
    includeDuration: true,
    includeArgs: false,
    fields: [
      { name: 'threadId', description: '대화 스레드 식별자', type: 'string' },
      { name: 'decision', description: '승인 또는 거절', type: 'string' },
      { name: 'hasChosenPlace', description: '대체 장소 선택 여부', type: 'boolean' },
    ],
    payload: (args) => {
      const dto = args[1] as ResumeThreadDto;
      return {
        threadId: args[0],
        decision: dto?.decision,
        hasChosenPlace: Boolean(dto?.chosenPlaceId),
      };
    },
  })
  async resumeThread(
    @LogField({ name: 'threadId', description: '대화 스레드 ID' })
    threadId: string,
    @LogField({ name: 'dto', description: '승인/거절 결정 및 대체 장소 ID' })
    dto: ResumeThreadDto,
    caller?: { userId?: string | null; threadSecret?: string | null; editToken?: string | null },
  ): Promise<ChatResponseDto> {
    const thread = await this.validateThreadAccess(threadId, {
      userId: caller?.userId,
      threadSecret: caller?.threadSecret || dto.threadSecret,
    });

    const editToken = caller?.editToken || dto.editToken || undefined;
    const config = {
      configurable: {
        thread_id: threadId,
        editToken,
        userId: thread.userId || caller?.userId || undefined,
      },
    };

    const resumePayload: ResumePayload = {
      decision: dto.decision,
      chosenPlaceId: dto.chosenPlaceId,
    };

    const resumeCommand = new Command({ resume: resumePayload });
    const graphWithResume = this.graph as unknown as {
      invoke: (cmd: unknown, cfg: unknown) => Promise<ChatState>;
    };
    const resultState = await graphWithResume.invoke(resumeCommand, config);

    return this.mapStateToResponse(threadId, resultState, thread.threadSecret);
  }

  async getThreadState(
    threadId: string,
    caller?: { userId?: string | null; threadSecret?: string | null },
  ): Promise<ChatResponseDto | null> {
    const thread = await this.validateThreadAccess(threadId, {
      userId: caller?.userId,
      threadSecret: caller?.threadSecret,
    });

    const config = { configurable: { thread_id: threadId } };
    const stateSnapshot = await this.graph.getState(config);

    if (!stateSnapshot || !stateSnapshot.values) {
      return null;
    }

    const state = stateSnapshot.values as ChatState;
    return this.mapStateToResponse(threadId, state, thread.threadSecret);
  }

  private mapStateToResponse(
    threadId: string,
    state: ChatState,
    threadSecret?: string,
    editToken?: string,
  ): ChatResponseDto {
    const status = state.status || 'completed';
    const responseMessage = state.responseMessage || '';

    return {
      threadId,
      threadSecret,
      ...(editToken ? { editToken } : {}),
      status,
      responseMessage,
      actionChips:
        state.actionChips && state.actionChips.length > 0 ? state.actionChips : undefined,
      pendingAction: state.pendingAction,
      alternatives:
        state.alternatives && state.alternatives.length > 0 ? state.alternatives : undefined,
      verifiedPlaceFacts: state.verifiedPlaceFacts,
      resultTripId: state.resultTripId,
      resultTrip: state.resultTrip,
      errorCode: state.errorCode,
    };
  }
}
