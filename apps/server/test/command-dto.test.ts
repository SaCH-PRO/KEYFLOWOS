import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCommandItemDto } from '../src/modules/command/dto/create-command-item.dto';
import { UpdateCommandItemDto } from '../src/modules/command/dto/update-command-item.dto';
import { ListCommandItemsDto } from '../src/modules/command/dto/list-command-items.dto';

const validCreate = {
  sourceModule: 'finance',
  title: 'Chase invoice',
  category: 'MONEY',
  actionType: 'COLLECT',
};

describe('Command DTOs accept SNOOZED', () => {
  it('CreateCommandItemDto allows status SNOOZED', async () => {
    const dto = plainToInstance(CreateCommandItemDto, { ...validCreate, status: 'SNOOZED' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.status).toBe('SNOOZED');
  });

  it('UpdateCommandItemDto allows status SNOOZED', async () => {
    const dto = plainToInstance(UpdateCommandItemDto, { status: 'SNOOZED' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.status).toBe('SNOOZED');
  });

  it('ListCommandItemsDto allows status SNOOZED filter', async () => {
    const dto = plainToInstance(ListCommandItemsDto, { status: 'SNOOZED' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.status).toBe('SNOOZED');
  });

  it('rejects an unknown status', async () => {
    const dto = plainToInstance(CreateCommandItemDto, { ...validCreate, status: 'FROZEN' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
