import { Module } from '@nestjs/common';
import { ConnectController } from './connect.controller';
import { GoogleFormsService } from './google-forms.service';
import { GoogleFormsMappingService } from './google-forms-mapping.service';
import { GoogleContactsSyncService } from './google-contacts-sync.service';
import { GoogleBusinessProfileService } from './google-business-profile.service';
import { CrmModule } from '../crm/crm.module';
import { ConnectorModule } from '../../core/connectors/connector.module';

@Module({
  imports: [CrmModule, ConnectorModule],
  controllers: [ConnectController],
  providers: [
    GoogleFormsService,
    GoogleFormsMappingService,
    GoogleContactsSyncService,
    GoogleBusinessProfileService,
  ],
  exports: [
    GoogleFormsService,
    GoogleFormsMappingService,
    GoogleContactsSyncService,
    GoogleBusinessProfileService,
  ],
})
export class ConnectModule {}
