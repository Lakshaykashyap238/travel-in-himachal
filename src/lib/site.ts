// Business details used across the site, structured data and legal pages.
// The owner must confirm every value before launch (see docs/OWNER-INPUTS.md).
export const SITE = {
  name: 'Travel In Himachal',
  tagline: 'Tours and cabs across Himachal Pradesh',
  phone: '+917876846613', // from the original site footer — owner to confirm
  email: 'support@travelinhimachal.co.in', // from the original site footer — owner to confirm
  region: 'Himachal Pradesh',
  country: 'IN',
} as const;

export const formatInr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
