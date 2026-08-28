import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

export interface ApiResponse<T> {
  success: true;
  data: T;
}

/**
 * NestJS interceptors wrap a route handler's execution, similar to Express
 * middleware but with access to both the request (before) and the response
 * value (after, via the RxJS pipe below) in one place. This one wraps every
 * successful handler return value in a consistent { success, data } envelope
 * so API consumers never have to guess the response shape.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data: T) => ({
        success: true as const,
        data: injectHasMore(data),
      })),
    );
  }
}

// Every paginated list() method in this app returns {results, total, page,
// limit} (the array field itself is sometimes named differently, e.g.
// escrows, but total/page/limit are consistent) — detecting that shape here,
// once, means every current and future paginated endpoint gets `hasMore`
// automatically rather than each service computing it by hand.
function injectHasMore<T>(data: T): T {
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    typeof (data as Record<string, unknown>).total === 'number' &&
    typeof (data as Record<string, unknown>).page === 'number' &&
    typeof (data as Record<string, unknown>).limit === 'number'
  ) {
    const { total, page, limit } = data as unknown as {
      total: number;
      page: number;
      limit: number;
    };
    return { ...data, hasMore: page * limit < total };
  }
  return data;
}
