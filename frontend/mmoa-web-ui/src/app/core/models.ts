/** The signed-in account (a partner nonprofit's login), as returned by
 *  /api/auth/login and /api/auth/me. */
export interface User {
  user_id: number;
  login_name: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string | null;
  email_verified: boolean;
  /** ISO-8601 UTC. */
  created_at?: string | null;
}

/** GET /api/public/config — the safe public subset of config.json. */
export interface PublicConfig {
  appTitle: string;
  appSubtitle: string;
  orgName: string;
  /** Nonprofit sign-up open? */
  allowMemberRegistration: boolean;
  passwordMinLength: number;
  /** TESTING / TEMPORARY (email.showLinksInBrowser): emailed links are also
   *  returned to the browser as `devLink` and shown on screen. */
  showLinksInBrowser: boolean;
}

/** GET /api/site — org facts + admin-editable website sections (HTML/). */
export interface SiteInfo {
  appTitle: string;
  orgName: string;
  phone: string;
  ein: string;
  facebookUrl: string;
  /** /content/images/logo.png|svg when the admin added one, else null. */
  logoUrl: string | null;
  /** hero, about, help, partner, footer — trusted admin HTML, tokens applied. */
  sections: Record<string, string>;
}

export interface Beneficiary {
  name: string;
  url: string | null;
  org_id?: number;
  /** /need-help/org/<id> — present only while that org is verified + listed. */
  profile_path?: string;
}

/** One published event. Times are ISO-8601 UTC. */
export interface EventItem {
  event_id: number;
  slug: string;
  title: string;
  summary: string;
  starts_at: string | null;
  ends_at: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  cover_url: string | null;
  flyer_url: string | null;
  registration_url: string | null;
  registration_label: string;
  registration_note: string | null;
  benefiting: string | null;
  is_upcoming: boolean;
  // detail only
  description_html?: string;
  map_url?: string | null;
  beneficiaries_text?: string | null;
  beneficiaries?: Beneficiary[];
}

export type RaffleStatus = 'open' | 'closed' | 'drawn';

export interface Raffle {
  raffle_id: number;
  slug: string;
  title: string;
  status: RaffleStatus;
  image_url: string | null;
  flyer_url: string | null;
  total_tickets: number | null;
  ticket_price_text: string | null;
  drawing_at: string | null;
  drawing_location: string | null;
  beneficiary: { name: string; org_id?: number; profile_path?: string } | null;
  /** Only once status = 'drawn'. */
  winning_ticket: string | null;
  // detail only
  prize_html?: string;
  images?: { url: string; alt: string }[];
  how_to_buy?: string;
  claim_requirements?: string[];
  claim_preset?: string | null;
}

export interface BoardMember {
  board_id: number;
  role_title: string;
  role_description: string;
  person_name: string | null;
  photo_url: string | null;
}

export interface Category { category_id: number; slug: string; name: string; }
export interface City { city_id: number; name: string; }

/** A verified + listed nonprofit as the public directory shows it. Every
 *  hidden field is simply absent. */
export interface PublicOrg {
  org_id: number;
  name: string;
  verified: boolean;
  address?: { line1: string | null; line2: string | null; city: string | null; state: string | null; zip: string | null; text: string };
  map_url?: string | null;
  phone?: string;
  public_email?: string;
  website_url?: string;
  facebook_url?: string;
  instagram_url?: string;
  other_social_url?: string;
  hours?: string;
  description_html?: string;
  what_to_bring?: string[];
  contacts?: { name: string | null; role: string | null; email: string | null; phone: string | null }[];
  images?: { url: string; alt: string }[];
  service_cities?: string[];
  categories?: { slug: string; name: string }[];
}

export interface SearchResponse {
  category: { slug: string; name: string } | null;
  city: string;
  q: string;
  count: number;
  results: PublicOrg[];
}

export interface OrgContact { contact_id?: number; name: string; role: string; email: string; phone: string; is_public: boolean; }
export interface OrgImage { image_id: number; url: string; alt: string; sort: number; }

/** The org's own full profile (portal). */
export interface PrivateOrg {
  org_id: number;
  name: string;
  ein: string;
  address_line1: string; address_line2: string; city: string; state: string; zip: string;
  phone: string; public_email: string;
  website_url: string; facebook_url: string; instagram_url: string; other_social_url: string;
  description_md: string; hours: string; what_to_bring: string;
  public_fields: string[];
  is_listed: boolean;
  verification_status: 'unverified' | 'verified' | 'rejected';
  verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  contacts: OrgContact[];
  images: OrgImage[];
  categories: string[];
  city_ids: number[];
}

export interface PortalPayload {
  org: PrivateOrg;
  preview: PublicOrg;
  isPublic: boolean;
  account: { login_name: string; email: string; first_name: string; last_name: string } | null;
  options: { categories: Category[]; cities: City[]; publicFieldKeys: string[]; maxImages: number };
  ok?: boolean;
  message?: string;
}

/** Responses from endpoints that email a link. `devLink` is present only
 *  while email.showLinksInBrowser is on (see DevLinkService). */
export interface LinkSentResponse {
  ok: boolean;
  message: string;
  email?: string;
  devLink?: string;
}
