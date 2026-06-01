import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CommandService } from './command.service';
import { CommandGeneratorService } from './command-generator.service';
import { CreateCommandItemDto } from './dto/create-command-item.dto';
import { UpdateCommandItemDto } from './dto/update-command-item.dto';
import { ListCommandItemsDto } from './dto/list-command-items.dto';

@Controller('command/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class CommandController {
  constructor(
    @Inject(CommandService) private readonly commandService: CommandService,
    @Inject(CommandGeneratorService) private readonly generator: CommandGeneratorService,
  ) {}

  @Get('items')
  async list(
    @Param('businessId') businessId: string,
    @Query() query: ListCommandItemsDto,
  ) {
    return this.commandService.findMany(businessId, {
      status: query.status,
      category: query.category,
      sourceModule: query.sourceModule,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('items/:id')
  async getOne(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.findOne(businessId, id);
  }

  @Post('items')
  async create(
    @Param('businessId') businessId: string,
    @Body() dto: CreateCommandItemDto,
  ) {
    return this.commandService.create(businessId, dto);
  }

  @Patch('items/:id')
  async update(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCommandItemDto,
  ) {
    return this.commandService.update(businessId, id, dto);
  }

  @Post('items/:id/dismiss')
  async dismiss(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.dismiss(businessId, id);
  }

  @Post('items/:id/snooze')
  async snooze(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { until: string },
  ) {
    return this.commandService.snooze(businessId, id, new Date(body.until));
  }

  @Post('items/:id/approve')
  async approve(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.approve(businessId, id);
  }

  @Post('items/:id/execute')
  async execute(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { result?: Record<string, unknown> },
  ) {
    return this.commandService.execute(businessId, id, body.result);
  }

  @Delete('items/:id')
  async delete(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.delete(businessId, id);
  }

  @Post('generate')
  async generate(
    @Param('businessId') businessId: string,
  ) {
    return this.generator.generateForBusiness(businessId);
  }

  @Get('summary')
  async summary(
    @Param('businessId') businessId: string,
  ) {
    return this.commandService.summary(businessId);
  }
}
