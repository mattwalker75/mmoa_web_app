/** The signed-in account, as returned by /api/auth/login and /api/auth/me. */
export interface User {
  user_id: number;
  login_name: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string | null;
  email_verified: boolean;
  /** ISO-8601 UTC ("member since"). */
  created_at?: string | null;
}

/** GET /api/public/config — the safe public subset of config.json. */
export interface PublicConfig {
  appTitle: string;
  appSubtitle: string;
  orgName: string;
  allowMemberRegistration: boolean;
  passwordMinLength: number;
  /** TESTING / TEMPORARY (email.showLinksInBrowser): emailed links are also
   *  returned to the browser as `devLink` and shown on screen. */
  showLinksInBrowser: boolean;
}

/** One published event (GET /api/events). Times are ISO-8601 UTC. */
export interface EventItem {
  event_id: number;
  title: string;
  description: string;
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_upcoming: boolean;
}

export interface EventsResponse {
  /** Upcoming (soonest first), then recent past events (newest first). */
  events: EventItem[];
  upcomingCount: number;
}

/** Responses from endpoints that email a link. `devLink` is present only
 *  while email.showLinksInBrowser is on (see DevLinkService). */
export interface LinkSentResponse {
  ok: boolean;
  message: string;
  email?: string;
  devLink?: string;
}

/** Per-window (panel) chrome for the home page, from HTML/windows.json.
 *  The server merges defaults so every field is always present. */
export interface WindowConfig {
  background: string;        // CSS color, or "none"/"transparent" for no fill
  borderColor: string;       // outline color ("transparent" = invisible but spaced)
  borderWidth: number;       // px (0 = no outline)
  borderStyle: string;       // solid | dashed | dotted | none
  width: number;             // % of page width (1-100)
  maxWidth: number;          // px cap
  radius: number;            // corner radius px
  shadow: boolean;           // drop shadow
  textColor: string | null;  // override text color, or null to inherit
  showTag: boolean;          // show the corner label
  tag: string;               // corner label text
  style?: Record<string, string>; // escape hatch: any CSS prop → value, applied last
}

export interface ContentResponse {
  sections: Record<string, string>;
  windows: Record<string, WindowConfig>;
}
