import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

const SLOW_THRESHOLD_MS = 1000;

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url, correlationId } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          const duration = Date.now() - start;
          const msg = `${method} ${url} ${res.statusCode} ${duration}ms [${correlationId ?? '-'}]`;
          if (duration > SLOW_THRESHOLD_MS) {
            this.logger.warn(`SLOW ${msg}`);
          } else {
            this.logger.debug(msg);
          }
        },
        error: (err: Error) => {
          const duration = Date.now() - start;
          this.logger.error(
            `${method} ${url} ERR ${duration}ms [${correlationId ?? '-'}] ${err.message}`,
          );
        },
      }),
    );
  }
}
