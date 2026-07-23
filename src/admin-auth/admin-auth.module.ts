import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { Admin, AdminSchema } from './schemas/admin.schema';
import {
  AdminRefreshToken,
  AdminRefreshTokenSchema,
} from './schemas/admin-refresh-token.schema';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Admin.name, schema: AdminSchema },
      { name: AdminRefreshToken.name, schema: AdminRefreshTokenSchema },
    ]),
    // global: true — learned the hard way earlier in this build (see
    // AuthGuardsModule's comment): Nest resolves a guard referenced by
    // class in @UseGuards() within the *consuming* module's own DI scope,
    // not through a normal exports chain. AdminModule references
    // AdminJwtAuthGuard by class, so JwtService (the guard's constructor
    // dependency) must be resolvable there too, not just inside
    // AdminAuthModule — a plain (non-global) JwtModule.register({}) would
    // only satisfy that dependency within this module's own scope. No
    // config collision risk from making it global: both AdminAuthService
    // and AdminJwtAuthGuard always pass the exact secret/expiry per call
    // rather than relying on a module-level default.
    JwtModule.register({ global: true }),
    EmailModule,
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtAuthGuard],
  exports: [AdminAuthService, AdminJwtAuthGuard],
})
export class AdminAuthModule {}
