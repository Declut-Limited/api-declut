import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { Admin, AdminSchema } from './schemas/admin.schema';
import { Role, RoleSchema } from '../roles/schemas/role.schema';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Admin.name, schema: AdminSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    // global: true — AdminJwtAuthGuard is referenced by class in AdminModule,
    // so its JwtService dependency must resolve there too, not just here.
    JwtModule.register({ global: true }),
    EmailModule,
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtAuthGuard, PermissionsGuard],
  exports: [AdminAuthService, AdminJwtAuthGuard, PermissionsGuard],
})
export class AdminAuthModule {}
