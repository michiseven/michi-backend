import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LogFriendsService } from './log-friends.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [LogFriendsService],
  exports: [LogFriendsService],
})
export class LogFriendsModule {}
