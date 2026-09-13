import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isValidObjectId } from 'mongoose';
import { Server, Socket } from 'socket.io';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

// User-facing real-time layer — separate namespace and secret from the admin bell (NotificationsGateway); users stay unaware of admin rooms and vice versa.
@Injectable()
@WebSocketGateway({ namespace: 'user-events', cors: { origin: true } })
export class UserEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(UserEventsGateway.name);

  @WebSocketServer()
  private server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // JWT-authed at handshake against the regular-user secret — every connected user auto-joins their own personal room, same as the admin bell.
  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        { secret: this.config.get<string>('JWT_ACCESS_SECRET') },
      );
      await client.join(this.userRoom(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // Nothing to clean up — socket.io drops room membership automatically.
  }

  // Client sends this while a listing detail screen or a feed card for this listing is on screen — not auto-joined, unlike the personal room.
  @SubscribeMessage('listing:subscribe')
  handleListingSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { listingId?: string },
  ): void {
    if (data?.listingId && isValidObjectId(data.listingId)) {
      void client.join(this.listingRoom(data.listingId));
    }
  }

  @SubscribeMessage('listing:unsubscribe')
  handleListingUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { listingId?: string },
  ): void {
    if (data?.listingId) {
      void client.leave(this.listingRoom(data.listingId));
    }
  }

  emitToUser(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.server) return;
    try {
      this.server.to(this.userRoom(userId)).emit(event, payload);
    } catch (err) {
      this.logger.error(
        `Failed to emit "${event}" to user ${userId}`,
        err as Error,
      );
    }
  }

  emitToListing(
    listingId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.server) return;
    try {
      this.server.to(this.listingRoom(listingId)).emit(event, payload);
    } catch (err) {
      this.logger.error(
        `Failed to emit "${event}" for listing ${listingId}`,
        err as Error,
      );
    }
  }

  // Every connected user gets this (the "new listing" doorbell) except the actor themselves, if given — no reason for a "something new just showed up" ping to loop back to whoever just created it.
  broadcastAll(
    event: string,
    payload: Record<string, unknown>,
    excludeUserId?: string,
  ): void {
    if (!this.server) return;
    try {
      const target = excludeUserId
        ? this.server.except(this.userRoom(excludeUserId))
        : this.server;
      target.emit(event, payload);
    } catch (err) {
      this.logger.error(`Failed to broadcast "${event}"`, err as Error);
    }
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private listingRoom(listingId: string): string {
    return `listing:${listingId}`;
  }

  private extractToken(client: Socket): string | undefined {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    if (fromAuth) {
      return fromAuth.startsWith('Bearer ')
        ? fromAuth.slice('Bearer '.length)
        : fromAuth;
    }
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return undefined;
  }
}
