import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from './admin.guard';

/**
 * JwtAuthGuard/AdminGuard live here rather than inside AuthModule so any
 * feature module can protect its routes without pulling in AuthModule's
 * full dependency graph (which itself depends on UsersModule — importing
 * AuthModule from UsersModule would create a circular module dependency).
 *
 * @Global(): Nest resolves a guard referenced by class in @UseGuards()
 * within the *consuming* module's own DI scope, not just via a regular
 * imports/exports chain — so every module using these guards would
 * otherwise need to import AuthGuardsModule explicitly AND still hit
 * resolution issues. Marking it global makes JwtAuthGuard/AdminGuard
 * resolvable everywhere with zero per-module wiring, which matches how
 * often they'll be used (almost every controller from here on).
 */
@Global()
@Module({
  // global: true here too — JwtAuthGuard's own JwtService dependency needs
  // to resolve in whichever module ends up constructing the guard, not just
  // within AuthGuardsModule's own scope.
  imports: [JwtModule.register({ global: true })],
  providers: [JwtAuthGuard, AdminGuard],
  exports: [JwtAuthGuard, AdminGuard],
})
export class AuthGuardsModule {}
