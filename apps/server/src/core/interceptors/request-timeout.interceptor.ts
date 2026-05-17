import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError, EMPTY } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';

const DEFAULT_TIMEOUT_MS = 30_000;
const FILE_UPLOAD_TIMEOUT_MS = 120_000;

@Injectable()
export class RequestTimeoutInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestTimeoutInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path ?? req.url;

    // Health/readiness probes must never be timed out by this layer
    if (path === '/healthz' || path === '/readyz') {
      return next.handle();
    }

    const isMultipart = req.headers['content-type']?.startsWith('multipart/form-data');
    const timeoutMs = isMultipart ? FILE_UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          const res = context.switchToHttp().getResponse<Response>();
          if (!res.headersSent) {
            res.status(503).json({ statusCode: 503, message: 'Request timeout' });
          }
          this.logger.warn(`Request timeout after ${timeoutMs}ms: ${req.method} ${path}`);
          return EMPTY;
        }
        return throwError(() => err);
      }),
    );
  }
}
