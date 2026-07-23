import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordResetTokenService } from '../password-reset-token.service';

/**
 * JwtAuthGuard lives here rather than inside AuthModule so any feature
 * module can protect its routes without pulling in AuthModule's full
 * dependency graph (which itself depends on UsersModule — importing
 * AuthModule from UsersModule would create a circular module dependency).
 * PasswordResetTokenService is here for the same reason: both AuthModule
 * (regular users) and AdminAuthModule (separate admin accounts) need it,
 * and it only depends on JwtService, which is already global via the
 * import below.
 *
 * (The old role-based AdminGuard that used to live here was removed —
 * admin access control now happens via AdminJwtAuthGuard in
 * src/admin-auth, which verifies a structurally separate JWT signed with
 * its own secret, since Admin is now its own Mongoose collection, not a
 * role flag on User.)
 *
 * @Global(): Nest resolves a guard referenced by class in @UseGuards()
 * within the *consuming* module's own DI scope, not just via a regular
 * imports/exports chain — so every module using these guards would
 * otherwise need to import AuthGuardsModule explicitly AND still hit
 * resolution issues. Marking it global makes JwtAuthGuard resolvable
 * everywhere with zero per-module wiring, which matches how often it's
 * used (almost every controller from here on).
 */
@Global()
@Module({
  // global: true here too — JwtAuthGuard's own JwtService dependency needs
  // to resolve in whichever module ends up constructing the guard, not just
  // within AuthGuardsModule's own scope.
  imports: [JwtModule.register({ global: true })],
  providers: [JwtAuthGuard, PasswordResetTokenService],
  exports: [JwtAuthGuard, PasswordResetTokenService],
})
export class AuthGuardsModule {}
