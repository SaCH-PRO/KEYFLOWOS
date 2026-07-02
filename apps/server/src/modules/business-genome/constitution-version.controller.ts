import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { ConstitutionVersionService } from './constitution-version.service';
import { GenerateConstitutionVersionDto } from './dto/generate-constitution-version.dto';

@Controller('business-genome/businesses/:businessId/constitution')
@UseGuards(AuthGuard, BusinessGuard)
export class ConstitutionVersionController {
  constructor(
    @Inject(ConstitutionVersionService) private readonly constitution: ConstitutionVersionService,
  ) {}

  private userId(req: { user?: { id?: string } }): string | undefined {
    return req.user?.id;
  }

  @Get('latest')
  latest(@Param('businessId') businessId: string) {
    return this.constitution.latest(businessId);
  }

  @Get('versions')
  versions(@Param('businessId') businessId: string) {
    return this.constitution.list(businessId);
  }

  @Get('versions/:version')
  version(
    @Param('businessId') businessId: string,
    @Param('version') version: string,
  ) {
    return this.constitution.getVersion(businessId, Number(version));
  }

  @Post('generate')
  @UseGuards(GenomeGateGuard)
  generate(
    @Param('businessId') businessId: string,
    @Body() body: GenerateConstitutionVersionDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.constitution.generate(businessId, body, this.userId(req));
  }

  @Get('staleness')
  staleness(@Param('businessId') businessId: string) {
    return this.constitution.staleness(businessId);
  }

  @Post('versions/:version/archive')
  archive(
    @Param('businessId') businessId: string,
    @Param('version') version: string,
  ) {
    return this.constitution.archive(businessId, Number(version));
  }
}
