export type BookingStatus = 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled';
export type StaffRole = 'owner' | 'staff';

export interface Booking {
  id: string;
  reference: string;
  tracking_token: string;
  type: 'tour' | 'cab';
  package_id: string | null;
  vehicle_id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  travel_date: string;
  travellers: number;
  pickup: string;
  dropoff: string | null;
  notes: string | null;
  status: BookingStatus;
  agreed_fare: number | null;
  rejection_reason: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
  package?: { name: string } | null;
  vehicle?: { name: string } | null;
}

export interface HistoryEntry {
  id: number;
  kind: 'created' | 'status_changed' | 'note';
  from_status: BookingStatus | null;
  to_status: BookingStatus | null;
  note: string | null;
  actor_name: string;
  created_at: string;
}

export interface StaffMember {
  user_id: string;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
  created_at?: string;
}

export interface TourRow {
  id: string;
  slug: string;
  name: string;
  duration_days: number;
  duration_nights: number;
  starting_price: number | null;
  best_time: string | null;
  group_size: string | null;
  summary: string | null;
  description: string | null;
  image_path: string | null;
  places: string[];
  itinerary: { day: number; title: string; details?: string }[];
  inclusions: string[];
  exclusions: string[];
  destination_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface VehicleRow {
  id: string;
  slug: string;
  name: string;
  seats: number;
  luggage: number;
  price_per_day: number | null;
  features: string[];
  description: string | null;
  image_path: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface DestinationRow {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  places: string[];
  image_path: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface SettingsRow {
  business_name: string;
  tagline: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  hours: string | null;
  about: string | null;
  founder_name: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  youtube_url: string | null;
  google_review_url: string | null;
  stat_travellers: number | null;
  stat_years: number | null;
  cancellation_policy: string | null;
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'New',
  accepted: 'Accepted',
  rejected: 'Rejected',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-900 ring-amber-300',
  accepted: 'bg-green-100 text-green-900 ring-green-300',
  rejected: 'bg-red-100 text-red-900 ring-red-300',
  completed: 'bg-slate-100 text-slate-700 ring-slate-300',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-300',
};

export interface ReviewRow {
  id: string;
  name: string;
  place: string | null;
  trip: string | null;
  rating: number;
  body: string;
  source: string;
  image_path: string | null;
  is_active: boolean;
  sort_order: number;
  from_customer?: boolean;
}
