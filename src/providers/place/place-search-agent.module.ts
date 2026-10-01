import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { UsersModule } from '../../users/users.module';
import { ProvidersModule } from '../providers.module';
import { PlaceSearchAgentController } from './place-search-agent.controller';
import { PlaceSearchAgentService } from './place-search-agent.service';

@Module({
  imports: [AiModule, UsersModule, ProvidersModule],
  providers: [PlaceSearchAgentService],
  controllers: [PlaceSearchAgentController],
  exports: [PlaceSearchAgentService],
})
export class PlaceSearchAgentModule {}
