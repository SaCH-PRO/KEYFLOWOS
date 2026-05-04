import { Module } from '@nestjs/common';
import { ConnectController } from './connect.controller';
import { GoogleFormsService } from './google-forms.service';
import { GoogleFormsMappingService } from './google-forms-mapping.service';
import { GoogleContactsSyncService } from './google-contacts-sync.service';
import { GoogleBusinessProfileService } from './google-business-profile.service';
import { GoogleMapsService } from './google-maps.service';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [CrmModule],
  controllers: [ConnectController],
  providers: [
    GoogleFormsService,
    GoogleFormsMappingService,
    GoogleContactsSyncService,
    GoogleBusinessProfileService,
    GoogleMapsService,
  ],
  exports: [
    GoogleFormsService,
    GoogleFormsMappingService,
    GoogleContactsSyncService,
    GoogleBusinessProfileService,
    GoogleMapsService,
  ],
})
export class ConnectModule {}
