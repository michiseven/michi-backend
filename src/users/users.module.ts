import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken, User, UserSavedTrip } from '../database/entities';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserSavedTrip, RefreshToken])],
  controllers: [UsersController],
  providers: [UsersService, JwtAuthGuard],
  exports: [UsersService, JwtAuthGuard, TypeOrmModule],
})
export class UsersModule {}
