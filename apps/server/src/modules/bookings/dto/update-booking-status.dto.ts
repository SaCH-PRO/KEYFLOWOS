import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Who cancelled a booking (V1-84, CR-V28-4). Only a CUSTOMER cancel forfeits a
 * paid deposit (D-26); a BUSINESS cancel forfeits nothing. BookingsService
 * defaults to BUSINESS, so KEY bookings_cancel_booking, undo, saga
 * compensation and the cortex adapter never forfeit (D-65).
 */
export const CANCEL_INITIATORS = ['CUSTOMER', 'BUSINESS'] as const;
export type CancelInitiator = (typeof CANCEL_INITIATORS)[number];

/**
 * POST bookings/businesses/:businessId/bookings/:bookingId/status.
 *
 * `status` is checked by BookingsService.updateBookingStatus (after the
 * booking is found, as before this DTO). `cancelledBy` says who cancelled;
 * absent on a CANCELLED, the route treats it as a customer cancel (D-65), and
 * any value other than CUSTOMER or BUSINESS answers 400.
 */
export class UpdateBookingStatusDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsIn(CANCEL_INITIATORS)
  cancelledBy?: CancelInitiator;
}
