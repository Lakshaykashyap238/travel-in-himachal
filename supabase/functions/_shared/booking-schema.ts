// Booking input rules shared by the website form (Astro/React) and the
// create-booking Edge Function (Deno). One definition, so the browser and
// the server can never disagree. The database enforces the same rules again
// in create_booking() as the final safety net.
import { z } from 'zod';

export const MAX_TRAVELLERS = 20;
export const MAX_DAYS_AHEAD = 180;

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be ${max} characters or fewer`);

/** E.164 phone number, e.g. +919876543210 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid mobile number with country code');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** YYYY-MM-DD */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a travel date');

export const bookingInputSchema = z
  .object({
    type: z.enum(['tour', 'cab']),
    packageSlug: z.string().trim().max(120).optional(),
    vehicleSlug: z.string().trim().min(1, 'Choose a car').max(120),
    customerName: trimmed(2, 80, 'Name'),
    phone: phoneSchema,
    email: z
      .union([z.literal(''), z.email('Enter a valid email address').max(160)])
      .optional()
      .transform((v) => (v ? v.toLowerCase() : undefined)),
    travelDate: isoDate,
    travellers: z.coerce.number().int().min(1).max(MAX_TRAVELLERS),
    pickup: trimmed(2, 200, 'Pickup location'),
    dropoff: optionalText(200),
    notes: optionalText(1000),
    consent: z.literal(true, { error: 'Please accept the privacy notice to continue' }),
  })
  .superRefine((b, ctx) => {
    if (b.type === 'tour' && !b.packageSlug) {
      ctx.addIssue({ code: 'custom', path: ['packageSlug'], message: 'Choose a tour' });
    }
    if (b.type === 'cab' && !b.dropoff) {
      ctx.addIssue({ code: 'custom', path: ['dropoff'], message: 'Drop-off location is required' });
    }
  });

export type BookingInput = z.input<typeof bookingInputSchema>;
export type BookingPayload = z.output<typeof bookingInputSchema>;

/** Shape returned to the browser after a successful booking. */
export interface BookingCreated {
  reference: string;
  trackingToken: string;
}

/** Error codes the API can return, so the UI can show friendly messages. */
export type BookingErrorCode =
  | 'invalid_input'
  | 'bot_check_failed'
  | 'rate_limited'
  | 'unavailable_item'
  | 'invalid_date'
  | 'server_error';
