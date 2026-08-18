import { AsyncLocalStorage } from 'async_hooks';

// Carries the current request's IP address into AuditLogService.record()
// without threading an ipAddress param through every one of the many
// existing call sites across Transactions/Listings/Reviews/Reports/etc. —
// AuditContextMiddleware populates this once per request; AuditLogService
// reads it at write time.
interface AuditContext {
  ipAddress?: string;
}

const storage = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(context: AuditContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getAuditIpAddress(): string | undefined {
  return storage.getStore()?.ipAddress;
}
