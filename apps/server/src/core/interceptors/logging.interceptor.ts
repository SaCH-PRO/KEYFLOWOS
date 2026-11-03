import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

const SLOW_THRESHOLD_MS = 1000;

/** What a log line names when Express matched no route (a 404, or an error thrown in middleware). */
export const UNROUTED = '<unrouted>';

/**
 * The route a log line names: the pattern Express matched
 * (`/commerce/public/invoice-link/:token`), else {@link UNROUTED}.
 *
 * Never the request URL and never its query. A URL carries credentials: link,
 * quote and export tokens, a webhook secret in the path, hub.verify_token, an
 * OAuth `code`, a portal token. The pattern keeps the line useful (method,
 * pattern, status, duration, correlation id) without any of them, and needs no
 * list of sensitive routes. LoggingInterceptor and GlobalHttpExceptionFilter
 * both use it, so the access line and the 500 line cannot drift apart (V1-83).
 */
export function routePatternOf(req: { route?: { path?: unknown } }): string {
  const pattern = req.route?.path;
  return typeof pattern === 'string' && pattern.length > 0 ? pattern : UNROUTED;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, correlationId } = req;
    const route = routePatternOf(req);
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          const duration = Date.now() - start;
          const msg = `${method} ${route} ${res.statusCode} ${duration}ms [${correlationId ?? '-'}]`;
          if (duration > SLOW_THRESHOLD_MS) {
            this.logger.warn(`SLOW ${msg}`);
          } else {
            this.logger.debug(msg);
          }
        },
        error: (err: Error) => {
          const duration = Date.now() - start;
          this.logger.error(
            `${method} ${route} ERR ${duration}ms [${correlationId ?? '-'}] ${err.message}`,
          );
        },
      }),
    );
  }
}
