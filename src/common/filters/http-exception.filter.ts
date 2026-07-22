import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * A "catch-all" filter — the Nest equivalent of an Express error-handling
 * middleware (the four-arg `(err, req, res, next)` kind), except Nest
 * dispatches to it automatically for anything thrown in a handler, guard,
 * pipe, or interceptor. @Catch() with no argument means it catches
 * everything, not just HttpExceptions, so an unexpected error can never leak
 * a raw stack trace or internal message to a client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException
      ? exception.getResponse()
      : null;

    const message = isHttpException
      ? this.extractMessage(exceptionResponse)
      : 'Internal server error';

    if (!isHttpException) {
      // Full detail goes to the server log only — never to the client, and
      // never anything from process.env in either place.
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    }

    response.status(status).json({
      success: false,
      error: {
        statusCode: status,
        message,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private extractMessage(exceptionResponse: unknown): string | string[] {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }
    if (
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      'message' in exceptionResponse
    ) {
      return (exceptionResponse as { message: string | string[] }).message;
    }
    return 'Unexpected error';
  }
}
