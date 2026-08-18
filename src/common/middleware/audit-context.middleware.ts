import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runWithAuditContext } from '../../audit-log/audit-log-context';

// Runs on every request, wraps the rest of the request in an
// AsyncLocalStorage context carrying the caller's IP so any AuditLog write
// triggered during handling can attach it — see audit-log-context.ts.
//
// Honesty flag: req.ip reflects the direct socket connection, not
// X-Forwarded-For — correct for this app's current direct-connection dev
// setup, but if this is ever deployed behind a reverse proxy/load balancer,
// Express's `trust proxy` setting would need to be configured for req.ip to
// reflect the real client IP instead of the proxy's. Not turned on here
// since blindly trusting X-Forwarded-For without knowing the real proxy
// topology would let a client spoof its own IP.
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    runWithAuditContext({ ipAddress: req.ip }, next);
  }
}
