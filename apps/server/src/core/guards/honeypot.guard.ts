import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const HONEYPOT_KEY = 'HONEYPOT_FIELDS';

export const Honeypot = (...fields: string[]) =>
  SetMetadata(HONEYPOT_KEY, fields.length > 0 ? fields : ['_hp', 'website_url', 'company_url']);

@Injectable()
export class HoneypotGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const fields = this.reflector.get<string[]>(HONEYPOT_KEY, context.getHandler())
      ?? ['_hp', 'website_url', 'company_url'];

    const req = context.switchToHttp().getRequest();
    const body = (req.body ?? {}) as Record<string, unknown>;

    for (const field of fields) {
      const v = body[field];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        // Silent reject — pretend success-ish but throw 400 so client sees consistent error
        throw new HttpException('Submission rejected.', HttpStatus.BAD_REQUEST);
      }
    }

    // Optional simple challenge: minimum render-to-submit time via _t (epoch ms)
    const tRaw = body._t;
    if (tRaw !== undefined && tRaw !== null && tRaw !== '') {
      const t = Number(tRaw);
      if (Number.isFinite(t) && t > 0 && Date.now() - t < 1500) {
        throw new HttpException('Submission too fast.', HttpStatus.BAD_REQUEST);
      }
    }

    return true;
  }
}
