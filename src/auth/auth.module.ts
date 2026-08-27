import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { GoogleModule } from '../google/google.module';
import { EmailModule } from '../email/email.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    // No default secret/expiry — AuthService passes the right one per call.
    JwtModule.register({}),
    UsersModule,
    GoogleModule,
    EmailModule,
    WaitlistModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
