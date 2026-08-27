import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

// Admin-only real-time bell — revives the AdminNotificationsGateway pattern removed 2026-08-26, now generalized to emit any saved admin Notification instead of a couple of hardcoded transaction events. Users stay socket-free.
@Injectable()
@WebSocketGateway({ namespace: 'admin-notifications', cors: { origin: true } })
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // JWT-authed at handshake, same as the removed gateway — one room per admin id, so a broadcast to one admin never reaches another.
  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<AdminAccessTokenPayload>(token, {
          secret: this.config.get<string>('JWT_ADMIN_ACCESS_SECRET'),
        });
      await client.join(this.roomFor(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // Nothing to clean up — socket.io drops room membership automatically.
  }

  emitToAdmin(adminId: string, notification: Record<string, unknown>): void {
    if (!this.server) {
      return;
    }
    try {
      this.server.to(this.roomFor(adminId)).emit('notification', notification);
    } catch (err) {
      this.logger.error(`Failed to emit to admin ${adminId}`, err as Error);
    }
  }

  // Called on logout — see NotificationsService.disconnectAdminSockets() for why this doesn't revoke the underlying JWT.
  disconnectAdmin(adminId: string): void {
    if (!this.server) {
      return;
    }
    this.server
      .in(this.roomFor(adminId))
      .fetchSockets()
      .then((sockets) => sockets.forEach((s) => s.disconnect(true)))
      .catch((err) =>
        this.logger.error(
          `Failed to disconnect admin ${adminId}`,
          err as Error,
        ),
      );
  }

  private roomFor(adminId: string): string {
    return `admin:${adminId}`;
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
