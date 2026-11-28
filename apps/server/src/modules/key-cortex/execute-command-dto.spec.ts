import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexController } from './key-cortex.controller';

describe('FU-CORTEX-EXECUTE-STRUCTURED-DTO: ExecuteCommandDto requires exactly one of command or module+action', () => {
  it('production ValidationPipe accepts structured module+action without command and accepts NL command alone', async () => {
    const { ValidationPipe } = await import('@nestjs/common');
    const { ExecuteCommandDto } = await import('./key-cortex.controller');
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    const structured = await pipe.transform(
      { businessId: 'biz_1', module: 'crm', action: 'add_note', parameters: { contactId: 'c1', note: 'hi' } },
      { type: 'body', metatype: ExecuteCommandDto },
    );
    expect(structured).toMatchObject({ businessId: 'biz_1', module: 'crm', action: 'add_note' });

    // Legacy empty-string command alongside module+action stays valid (R0 key-cortex-actor-binding compat)
    const legacyStructured = await pipe.transform(
      { businessId: 'biz_1', command: '', module: 'crm', action: 'add_note', parameters: {} },
      { type: 'body', metatype: ExecuteCommandDto },
    );
    expect(legacyStructured).toMatchObject({ businessId: 'biz_1', module: 'crm', action: 'add_note' });

    const natural = await pipe.transform(
      { businessId: 'biz_1', command: 'list my contacts' },
      { type: 'body', metatype: ExecuteCommandDto },
    );
    expect(natural).toMatchObject({ businessId: 'biz_1', command: 'list my contacts' });
  });

  it('production ValidationPipe rejects ambiguous (both), partial (module-only / action-only), empty, or suggestion-card-shaped bodies with 400', async () => {
    const { BadRequestException, ValidationPipe } = await import('@nestjs/common');
    const { ExecuteCommandDto } = await import('./key-cortex.controller');
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    const invalidBodies: Array<[string, Record<string, unknown>]> = [
      ['both command and module+action', { businessId: 'biz_1', command: 'add a contact', module: 'crm', action: 'add_note' }],
      ['command + module without action', { businessId: 'biz_1', command: 'add a contact', module: 'crm' }],
      ['command + action without module', { businessId: 'biz_1', command: 'add a contact', action: 'add_note' }],
      ['module without action', { businessId: 'biz_1', module: 'crm' }],
      ['action without module', { businessId: 'biz_1', action: 'add_note' }],
      ['whitespace module', { businessId: 'biz_1', module: '   ', action: 'add_note' }],
      ['whitespace action', { businessId: 'biz_1', module: 'crm', action: '   ' }],
      ['neither command nor module+action', { businessId: 'biz_1' }],
      ['whitespace-only command', { businessId: 'biz_1', command: '   ' }],
      ['broken suggestion-card payload', { businessId: 'biz_1', suggestionId: 's1', endpoint: '/crm/notes', payload: {} }],
      ['non-string module', { businessId: 'biz_1', module: 123, action: 'add_note' }],
      ['non-string command alongside structured', { businessId: 'biz_1', command: 123, module: 'crm', action: 'add_note' }],
      ['whitespace-only command alongside structured', { businessId: 'biz_1', command: '   ', module: 'crm', action: 'add_note' }],
      ['JSON null command alongside structured', { businessId: 'biz_1', command: null, module: 'crm', action: 'add_note' }],
      ['JSON null module alongside command', { businessId: 'biz_1', command: 'list contacts', module: null }],
      ['JSON null action alongside command', { businessId: 'biz_1', command: 'list contacts', action: null }],
      ['omitted businessId', { command: 'list contacts' }],
      ['empty businessId', { businessId: '   ', command: 'list contacts' }],
    ];

    for (const [label, body] of invalidBodies) {
      await expect(
        pipe.transform(body, { type: 'body', metatype: ExecuteCommandDto }),
        label,
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('executeCommand handler enforces the same either/or rule, executes structured module+action without command for a permitted member, and refuses 403 otherwise (D-140/D-119)', async () => {
    const { BadRequestException, ForbiddenException } = await import('@nestjs/common');
    const executor = {
      execute: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
      logExecution: vi.fn().mockResolvedValue({ id: 'log_1' }),
    };
    const commandSvc = { parseIntent: vi.fn(), toConnectorCommand: vi.fn() };
    const connector = { getAllCapabilities: vi.fn().mockReturnValue([]) };
    const prisma = { client: { aiExecutionLog: { create: vi.fn().mockResolvedValue({ id: 'log_1' }) } } };
    const ctl = new KeyCortexController(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      connector as any, commandSvc as any, executor as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, prisma as any,
    );
    const actor = { id: 'owner_1', email: 'owner@test.local', role: 'USER' };
    const ownerMember = {
      businessId: 'biz_1',
      userId: 'owner_1',
      role: 'OWNER',
      superAdmin: false,
      member: true,
      scopes: { crm: 'admin' },
    } as any;
    const staffMember = {
      businessId: 'biz_1',
      userId: 'staff_1',
      role: 'STAFF',
      superAdmin: false,
      member: true,
      scopes: { crm: 'none' },
    } as any;

    const ok = await ctl.executeCommand(
      { businessId: 'biz_1', module: 'crm', action: 'add_note', parameters: { contactId: 'c1', note: 'hello' } },
      actor,
      ownerMember,
    );
    expect(ok).toMatchObject({ success: true });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(commandSvc.parseIntent).not.toHaveBeenCalled();

    // Unpermitted member is refused 403 (D-140/D-119) with an audit row naming the member
    await expect(
      ctl.executeCommand(
        { businessId: 'biz_1', module: 'crm', action: 'add_note', parameters: { contactId: 'c1', note: 'hello' } },
        { id: 'staff_1', email: 'staff@test.local', role: 'USER' },
        staffMember,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.logExecution).toHaveBeenCalledTimes(1);

    // Ambiguous (both) and partial (module-only) direct handler calls are refused 400
    await expect(
      ctl.executeCommand(
        { businessId: 'biz_1', command: 'add note', module: 'crm', action: 'add_note' },
        actor,
        ownerMember,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      ctl.executeCommand(
        { businessId: 'biz_1', module: 'crm' },
        actor,
        ownerMember,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
