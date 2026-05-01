import { Module } from '@nestjs/common';
import { ConnectController } from './connect.controller';
import { GoogleFormsService } from './google-forms.service';
import { GoogleContactsSyncService } from './google-contacts-sync.service';
import { GoogleBusinessProfileService } from './google-business-profile.service';
import { GoogleMapsService } from './google-maps.service';

@Module({
  controllers: [ConnectController],
  providers: [
    GoogleFormsService,
    GoogleContactsSyncService,
    GoogleBusinessProfileService,
    GoogleMapsService,
  ],
  exports: [
    GoogleFormsService,
    GoogleContactsSyncService,
    GoogleBusinessProfileService,
    GoogleMapsService,
  ],
})
export class ConnectModule {}
