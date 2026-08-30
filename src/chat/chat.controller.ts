import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ChatService } from './chat.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ResumeThreadDto } from './dto/resume-thread.dto';
import type { ChatResponseDto, CreateThreadResponseDto } from './dto/chat-response.dto';
import { verifyJwt } from '../users/utils/crypto-auth.util';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly config: ConfigService,
  ) {}

  private extractUserId(req: Request): string | null {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    const secret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) return null;
    try {
      const payload = verifyJwt(token, secret);
      return payload.type === 'access' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  private extractThreadSecret(req: Request, dto?: { threadSecret?: string }): string | null {
    return dto?.threadSecret || (req.headers['x-thread-secret'] as string | undefined) || null;
  }

  private extractEditToken(req: Request, dto?: { editToken?: string }): string | null {
    return dto?.editToken || (req.headers['x-trip-edit-token'] as string | undefined) || null;
  }

  @Post('threads')
  async createThread(
    @Body() dto?: CreateThreadDto,
    @Req() req?: Request,
  ): Promise<CreateThreadResponseDto> {
    const userId = req ? this.extractUserId(req) : null;
    return this.chatService.createThread(dto, userId);
  }

  @Post('threads/:threadId/messages')
  async sendMessage(
    @Param('threadId') threadId: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ): Promise<ChatResponseDto> {
    const userId = this.extractUserId(req);
    const threadSecret = this.extractThreadSecret(req, dto);
    const editToken = this.extractEditToken(req, dto);

    return this.chatService.sendMessage(threadId, dto, {
      userId,
      threadSecret,
      editToken,
    });
  }

  @Post('threads/:threadId/resume')
  async resumeThread(
    @Param('threadId') threadId: string,
    @Body() dto: ResumeThreadDto,
    @Req() req: Request,
  ): Promise<ChatResponseDto> {
    const userId = this.extractUserId(req);
    const threadSecret = this.extractThreadSecret(req, dto);
    const editToken = this.extractEditToken(req, dto);

    return this.chatService.resumeThread(threadId, dto, {
      userId,
      threadSecret,
      editToken,
    });
  }

  @Get('threads/:threadId/state')
  async getThreadState(
    @Param('threadId') threadId: string,
    @Req() req: Request,
  ): Promise<ChatResponseDto> {
    const userId = this.extractUserId(req);
    const threadSecret = this.extractThreadSecret(req);

    const state = await this.chatService.getThreadState(threadId, {
      userId,
      threadSecret,
    });

    return state!;
  }
}
