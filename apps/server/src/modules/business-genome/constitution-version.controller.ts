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
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ConstitutionVersionService } from './constitution-version.service';
import { GenerateConstitutionVersionDto } from './dto/generate-constitution-version.dto';
import { constitutionVersionForReader, readsRevenueFor, stalenessForReader } from './key-genome/genome-composites-for-reader';

type ReaderRequest = { user?: { id?: string; role?: string } };

@Controller('business-genome/businesses/:businessId/constitution')
@UseGuards(AuthGuard, BusinessGuard)
export class ConstitutionVersionController {
  constructor(
    @Inject(ConstitutionVersionService) private readonly constitution: ConstitutionVersionService,
    // FU-GENOME-SURFACES-REVENUE (D-233): reads the request member's revenue level; without it, fail closed.
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  private readsRevenue(businessId: string, req?: ReaderRequest): Promise<boolean> {
    const user = req?.user;
    return readsRevenueFor(this.prisma, businessId, user?.id ? { id: user.id, role: user.role } : null);
  }

  private userId(req: { user?: { id?: string } }): string | undefined {
    return req.user?.id;
  }

  @Get('latest')
  async latest(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    const row = await this.constitution.latest(businessId);
    return constitutionVersionForReader(row, await this.readsRevenue(businessId, req));
  }

  @Get('versions')
  async versions(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    const rows = await this.constitution.list(businessId);
    const readsRevenue = await this.readsRevenue(businessId, req);
    return rows.map((row) => constitutionVersionForReader(row, readsRevenue));
  }

  @Get('versions/:version')
  async version(
    @Param('businessId') businessId: string,
    @Param('version') version: string,
    @Req() req?: ReaderRequest,
  ) {
    const row = await this.constitution.getVersion(businessId, Number(version));
    return constitutionVersionForReader(row, await this.readsRevenue(businessId, req));
  }

  @Post('generate')
  @UseGuards(GenomeGateGuard)
  async generate(
    @Param('businessId') businessId: string,
    @Body() body: GenerateConstitutionVersionDto,
    @Req() req: ReaderRequest,
  ) {
    const row = await this.constitution.generate(businessId, body, this.userId(req));
    return constitutionVersionForReader(row, await this.readsRevenue(businessId, req));
  }

  @Get('staleness')
  async staleness(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    const staleness = await this.constitution.staleness(businessId);
    return stalenessForReader(staleness, await this.readsRevenue(businessId, req));
  }

  @Post('versions/:version/archive')
  async archive(
    @Param('businessId') businessId: string,
    @Param('version') version: string,
    @Req() req?: ReaderRequest,
  ) {
    const row = await this.constitution.archive(businessId, Number(version));
    return constitutionVersionForReader(row, await this.readsRevenue(businessId, req));
  }
}
