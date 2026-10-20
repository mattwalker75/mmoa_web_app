/**
 * User-facing strings for the "Need Help?" pages and the nonprofit directory
 * (search, results, public profile), kept in one place so a Spanish
 * translation can be added later (e.g. an `es` object with the same keys and
 * a language switch). English only for now.
 */
export const NEED_HELP_STRINGS = {
  en: {
    emergency911: 'Emergency? Call 911',
    crisis988: 'Crisis or suicide: call or text 988',
    services211: 'More services: dial 211',
    kicker: 'Free · No account needed · Nothing saved',
    title: 'Find help near Anna',
    intro: "Choose what you need. We'll show local nonprofits that Mission Men of Anna has verified.",
    stepNeed: '1. What do you need help with?',
    pickHint: 'Choose one or more. No choice shows everything.',
    clearAll: 'Clear all',
    selectedCount: (n: number) => `${n} selected`,
    stepCity: '2. City',
    anyCity: 'Any city',
    keyword: 'Keyword (optional)',
    keywordPlaceholder: 'e.g. diapers, rent, groceries',
    search: 'Search',
    clearSearch: 'Clear search',
    searching: 'Searching…',
    // needs: the selected category names; joined "food, utilities or housing".
    resultsSummary: (n: number, needs: string[], city: string | null) =>
      `${n} ${n === 1 ? 'place helps' : 'places help'}` +
      (needs.length ? ` with ${new Intl.ListFormat('en', { type: 'disjunction' }).format(needs.map(x => x.toLowerCase()))}` : '') +
      (city ? ` in ${city}` : ' near Anna'),
    noResults: 'No verified nonprofits match yet. Try "Any city", or dial 211 to talk to someone about local services.',
    loadError: "We couldn't load the directory just now. Please try again, or dial 211 for help finding local services.",
    verified: '✓ Verified by MMoA',
    whatToBring: 'What to bring',
    call: 'Call',
    directions: 'Directions',
    website: 'Website',
    fullProfile: 'Full profile',
    listingNote: 'Listings are provided by each nonprofit and verified by Mission Men of Anna.',
    getListed: 'Are you a nonprofit? Get listed',
    backToSearch: '← Back to search',
    notFound: "This profile isn't available. It may have been removed or hidden by the organization.",
    about: 'About',
    services: 'Services',
    citiesServed: 'Cities served',
    hours: 'Hours',
    contact: 'Contact',
    address: 'Address',
    email: 'Email',
    phone: 'Phone',
    facebook: 'Facebook',
    instagram: 'Instagram',
    otherLink: 'More',
    people: 'People to contact',
    photos: 'Photos'
  }
};

/** The active language's strings (English until a translation is added). */
export const S = NEED_HELP_STRINGS.en;
