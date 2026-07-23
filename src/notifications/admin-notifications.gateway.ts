import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket as IoSocket } from 'socket.io';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

const ADMIN_ROOM = 'admins';

interface AdminSocketData {
  adminId?: string;
}

// socket.io types `Socket.data` as `any` unless the SocketData generic is
// given — this pins it to a real shape so client.data.adminId below is a
// checked assignment, not an unsafe any-access.
type Socket = IoSocket<any, any, any, AdminSocketData>;

/**
 * Admin-only live notifications (new dispute, transaction stalled, etc.) —
 * confirmed with the user as strictly an admin-facing channel, not a
 * regular-user-facing one, since this repo has no companion web app for
 * buyers/sellers (they stay on FCM push, via NotificationsService).
 *
 * Auth happens at the WS handshake, not via CORS: the client connects with
 * its admin access token in `auth: { token }` (socket.io's handshake auth
 * payload) or an `Authorization: Bearer` header, verified here against
 * JWT_ADMIN_ACCESS_SECRET — the exact same secret/verification AdminJwtAuthGuard
 * uses for HTTP, so a socket can never do anything an HTTP request with the
 * same token couldn't. A connection that fails this check is disconnected
 * immediately, before joining the broadcast room. CORS on the gateway itself
 * is left permissive (`origin: true`) since the JWT check is the real
 * boundary here — unlike a browser page's CORS-restricted `fetch`, a raw
 * socket.io handshake's Origin header isn't a meaningful trust signal on
 * its own.
 */
@Injectable()
@WebSocketGateway({
  namespace: 'admin-notifications',
  cors: { origin: true, credentials: true },
})
export class AdminNotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AdminNotificationsGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

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
      client.data.adminId = payload.sub;
      await client.join(ADMIN_ROOM);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // socket.io removes the client from every room automatically — nothing
    // else to clean up, since no per-connection state is kept beyond that.
  }

  broadcast(event: string, payload: Record<string, unknown>): void {
    if (!this.server) {
      // Not yet initialized (e.g. called during a very early bootstrap
      // path) — same "never break the caller" posture as NotificationsService.
      this.logger.warn(`WS server not ready — dropped ${event}`);
      return;
    }
    this.server.to(ADMIN_ROOM).emit(event, payload);
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) {
      return authToken;
    }
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return undefined;
  }
}
