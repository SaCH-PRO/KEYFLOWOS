import {
  Body,
  Controller,
  Get,
  Inject,
  Optional,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  constitutionVersionForReader,
  readsRevenueFor,
  stalenessForReader,
} from './key-genome/genome-composites-for-reader';
import { ConstitutionVersionService } from './constitution-version.service';
import { GenerateConstitutionVersionDto } from './dto/generate-constitution-version.dto';

type ConstitutionRequest = { user?: { id?: string; role?: string } };

@Controller('business-genome/businesses/:businessId/constitution')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class ConstitutionVersionController {
  constructor(
    @Inject(ConstitutionVersionService) private readonly constitution: ConstitutionVersionService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  private userId(req?: ConstitutionRequest): string | undefined {
    return req?.user?.id;
  }

  private readsRevenue(businessId: string, req?: ConstitutionRequest): Promise<boolean> {
    return readsRevenueFor(this.prisma, businessId, req?.user?.id ? { id: req.user.id, role: req.user.role } : null);
  }

  @Get('latest')
  async latest(@Param('businessId') businessId: string, @Req() req?: ConstitutionRequest) {
    const [row, readsRevenue] = await Promise.all([
      this.constitution.latest(businessId),
      this.readsRevenue(businessId, req),
    ]);
    return constitutionVersionForReader(row, readsRevenue);
  }

  @Get('versions')
  async versions(@Param('businessId') businessId: string, @Req() req?: ConstitutionRequest) {
    const [rows, readsRevenue] = await Promise.all([
      this.constitution.list(businessId),
      this.readsRevenue(businessId, req),
    ]);
    return rows.map((r) => constitutionVersionForReader(r, readsRevenue));
  }

  @Get('versions/:version')
  async version(
    @Param('businessId') businessId: string,
    @Param('version') version: string,
    @Req() req?: ConstitutionRequest,
  ) {
    const [row, readsRevenue] = await Promise.all([
      this.constitution.getVersion(businessId, Number(version)),
      this.readsRevenue(businessId, req),
    ]);
    return constitutionVersionForReader(row, readsRevenue);
  }

  @RequireModuleScope('settings', 'write')
  @Post('generate')
  @UseGuards(GenomeGateGuard)
  async generate(
    @Param('businessId') businessId: string,
    @Body() body: GenerateConstitutionVersionDto,
    @Req() req: ConstitutionRequest,
  ) {
    const [row, readsRevenue] = await Promise.all([
      this.constitution.generate(businessId, body, this.userId(req)),
      this.readsRevenue(businessId, req),
    ]);
    return constitutionVersionForReader(row, readsRevenue);
  }

  @Get('staleness')
  async staleness(@Param('businessId') businessId: string, @Req() req?: ConstitutionRequest) {
    const [staleness, readsRevenue] = await Promise.all([
      this.constitution.staleness(businessId),
      this.readsRevenue(businessId, req),
    ]);
    return stalenessForReader(staleness, readsRevenue);
  }

  @RequireModuleScope('settings', 'write')
  @Post('versions/:version/archive')
  async archive(
    @Param('businessId') businessId: string,
    @Param('version') version: string,
    @Req() req?: ConstitutionRequest,
  ) {
    const [row, readsRevenue] = await Promise.all([
      this.constitution.archive(businessId, Number(version)),
      this.readsRevenue(businessId, req),
    ]);
    return constitutionVersionForReader(row, readsRevenue);
  }
}
