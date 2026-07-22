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
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(map((data) => ({ success: true, data })));
  }
}
