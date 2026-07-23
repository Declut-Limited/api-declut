import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  check() {
    const mongoStates = [
      'disconnected',
      'connected',
      'connecting',
      'disconnecting',
    ];
    return {
      status: 'ok',
      mongo: mongoStates[this.connection.readyState] ?? 'unknown',
    };
  }
}
