// Build-time catalogue loader.
//
// Production builds (deploy / "Publish changes") read the live catalogue that
// the owner edits in /admin. Local and CI builds without Supabase settings use
// src/data/fallback-catalogue.json. With REQUIRE_LIVE_CATALOGUE=true the build
// fails instead of silently publishing stale content.
import type { ImageMetadata } from 'astro';
import fallback from '@/data/fallback-catalogue.json';

export interface SiteSettings {
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
  google_review_url: string | null;
  stat_travellers: number | null;
  stat_years: number | null;
  cancellation_policy: string | null;
}

export interface ItineraryDay {
  day: number;
  title: string;
  details?: string;
}

export interface Tour {
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
  itinerary: ItineraryDay[];
  inclusions: string[];
  exclusions: string[];
  destination_slug: string | null;
  sort_order: number;
}

export interface Vehicle {
  slug: string;
  name: string;
  seats: number;
  luggage: number;
  price_per_day: number | null;
  features: string[];
  description: string | null;
  image_path: string | null;
  sort_order: number;
}

export interface Destination {
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  places: string[];
  image_path: string | null;
  sort_order: number;
}

export interface Catalogue {
  settings: SiteSettings;
  tours: Tour[];
  vehicles: Vehicle[];
  destinations: Destination[];
  source: 'live' | 'fallback';
}

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
const REQUIRE_LIVE = process.env.REQUIRE_LIVE_CATALOGUE === 'true';

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Supabase ${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function loadLive(): Promise<Catalogue> {
  const [settings, tours, vehicles, destinations] = await Promise.all([
    rest<SiteSettings[]>('site_settings?select=*'),
    rest<(Omit<Tour, 'destination_slug'> & { destinations: { slug: string } | null })[]>(
      'packages?select=*,destinations(slug)&is_active=eq.true&order=sort_order,name',
    ),
    rest<Vehicle[]>('vehicles?select=*&is_active=eq.true&order=sort_order,name'),
    rest<Destination[]>('destinations?select=*&is_active=eq.true&order=sort_order,name'),
  ]);
  if (!settings[0]) throw new Error('site_settings row missing');
  return {
    settings: settings[0],
    tours: tours.map(({ destinations: d, ...t }) => ({ ...t, destination_slug: d?.slug ?? null })),
    vehicles,
    destinations,
    source: 'live',
  };
}

let cached: Promise<Catalogue> | undefined;

export function getCatalogue(): Promise<Catalogue> {
  cached ??= (async () => {
    if (SUPABASE_URL && ANON_KEY) {
      try {
        return await loadLive();
      } catch (e) {
        if (REQUIRE_LIVE) throw e;
        console.warn(`[catalogue] live load failed, using fallback: ${(e as Error).message}`);
      }
    } else if (REQUIRE_LIVE) {
      throw new Error('REQUIRE_LIVE_CATALOGUE is set but PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY are missing');
    }
    const f = fallback as unknown as Omit<Catalogue, 'source' | 'tours'> & { packages: Tour[] };
    return { settings: f.settings, tours: f.packages, vehicles: f.vehicles, destinations: f.destinations, source: 'fallback' };
  })();
  return cached;
}

// ── Images ──────────────────────────────────────────────────────────
// image_path is either a bundled photo ("/images/tours/shimla.jpg", optimised
// by Astro from src/assets) or a photo the owner uploaded in /admin
// ("catalogue/<file>" in Supabase Storage, downloaded and optimised at build).
const bundled = import.meta.glob<{ default: ImageMetadata }>('/src/assets/**/*.{jpg,jpeg,png,webp}', {
  eager: true,
});

export function resolveImage(path: string | null | undefined): ImageMetadata | string | null {
  if (!path) return null;
  if (path.startsWith('/images/')) {
    const key = `/src/assets/${path.slice('/images/'.length)}`;
    return bundled[key]?.default ?? null;
  }
  if (SUPABASE_URL && /^catalogue\/[\w./-]+$/.test(path)) {
    return `${SUPABASE_URL}/storage/v1/object/public/${path}`;
  }
  return null;
}

// ── Formatting ──────────────────────────────────────────────────────
export const formatInr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export const durationLabel = (t: Pick<Tour, 'duration_days' | 'duration_nights'>) =>
  `${t.duration_days} ${t.duration_days === 1 ? 'Day' : 'Days'} / ${t.duration_nights} ${t.duration_nights === 1 ? 'Night' : 'Nights'}`;

/** "+917876846613" → "+91 78768 46613" */
export const formatPhone = (e164: string) =>
  e164.startsWith('+91') && e164.length === 13 ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164;

export const whatsappLink = (e164: string, text?: string) =>
  `https://wa.me/${e164.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
