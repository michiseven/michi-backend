import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createNodeClient,
  registerAgent,
  reportDiscoveredEvents,
  setGlobalClient,
  type NodeLogFriendsClient,
} from '@logfriends/sdk';

@Injectable()
export class LogFriendsService
  implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(LogFriendsService.name);
  private client: NodeLogFriendsClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const ingestUrl =
      this.configService.get<string>('LOGFRIENDS_INGEST_URL') || 'http://localhost:8080/ingest';
    const workerId = this.configService.get<string>('LOGFRIENDS_WORKER_ID') || 'michi-backend';

    this.client = createNodeClient({
      ingestUrl,
      workerId,
      maxQueueSize: this.configService.get<number>('LOGFRIENDS_QUEUE_CAPACITY') || 10_000,
      maxQueueBytes:
        this.configService.get<number>('LOGFRIENDS_QUEUE_MEMORY_BUDGET_BYTES') || 33_554_432,
      batchSize: this.configService.get<number>('LOGFRIENDS_BATCH_SIZE') || 100,
      flushIntervalMs: this.configService.get<number>('LOGFRIENDS_BATCH_INTERVAL_MS') || 500,
    });

    setGlobalClient(this.client);

    this.logger.log(`Log Friends telemetry initialized for worker "${workerId}" -> ${ingestUrl}`);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.client) {
      try {
        const workerId = this.configService.get<string>('LOGFRIENDS_WORKER_ID') || 'michi-backend';
        const appName = this.configService.get<string>('LOGFRIENDS_APP_NAME') || 'michi';
        const registration = await registerAgent(this.client, {
          appName,
          sourceType: 'NODE',
          metadata: { service: 'michi-backend' },
        });
        if (!registration.success || registration.agentId === undefined) {
          throw registration.error ?? new Error('Log Friends agent registration failed.');
        }

        const res = await reportDiscoveredEvents(this.client, {
          agentId: registration.agentId,
          appName,
        });
        if (res.success) {
          this.logger.log(
            `Log Friends agent "${workerId}" registered; reported ${res.received} event schemas to Console.`,
          );
        } else {
          throw res.error ?? new Error('Log Friends event schema reporting failed.');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to report discovered event schemas to Log Friends: ${message}`);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch {
        // Suppress shutdown flush error
      }
    }
  }

  getClient(): NodeLogFriendsClient | null {
    return this.client;
  }

  track(eventName: string, payload: Record<string, unknown> = {}): boolean {
    if (!this.client) return false;
    try {
      return this.client.track(eventName, payload);
    } catch {
      return false;
    }
  }
}
