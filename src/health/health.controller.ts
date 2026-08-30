import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CROWD_PROVIDER, type CrowdProvider } from '../providers/crowd/crowd-provider';
import { PLACE_PROVIDER, type PlaceProvider } from '../providers/place/place-provider';

interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'connected' | 'unavailable';
  providerModes: {
    place: 'mock' | 'live';
    crowd: 'mock' | 'live';
    llm: 'mock' | 'live';
    kto: 'mock' | 'live';
    tourismDataLab: 'mock' | 'live';
    routing: 'mock' | 'live';
    accessibility: 'live' | 'unavailable';
  };
  providerSources: {
    place: string;
    crowd: string;
  };
  timestamp: string;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(PLACE_PROVIDER) private readonly places: PlaceProvider,
    @Inject(CROWD_PROVIDER) private readonly crowd: CrowdProvider,
  ) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    let database: HealthResponse['database'] = 'unavailable';
    let accessibility: HealthResponse['providerModes']['accessibility'] = 'unavailable';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'connected';
      const rows = await this.dataSource.query<Array<{ available: boolean }>>(
        'SELECT EXISTS (SELECT 1 FROM pedestrian_accessibility_features) AS available',
      );
      accessibility = rows[0]?.available ? 'live' : 'unavailable';
    } catch {
      database = 'unavailable';
    }
    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
      providerModes: {
        place: this.places.mode,
        crowd: this.crowd.mode,
        llm: this.config.getOrThrow<'mock' | 'live'>('LLM_PROVIDER_MODE'),
        kto: this.config.getOrThrow<'mock' | 'live'>('KTO_PROVIDER_MODE'),
        tourismDataLab: this.config.getOrThrow<'mock' | 'live'>('KTO_DATALAB_PROVIDER_MODE'),
        routing: this.config.getOrThrow<'mock' | 'live'>('ROUTING_PROVIDER_MODE'),
        accessibility,
      },
      providerSources: {
        place: this.places.name,
        crowd: this.crowd.name,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
