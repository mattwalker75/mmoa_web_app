/**
 * Fixed About-page content that isn't one of the admin-editable HTML/
 * sections (those are hero, about, help, partner, footer). Edit here and
 * rebuild the SPA to change it.
 */
export const CORE_VALUES = [
  { name: 'Integrity', text: 'Upholding honesty and ethical standards in all actions and decisions.' },
  { name: 'Community Engagement', text: 'Actively participating in local initiatives to strengthen relationships and support within the community.' },
  { name: 'Empowerment', text: 'Fostering personal growth and development in members to create strong men who positively impact their families and communities.' },
  { name: 'Service', text: 'Committing to serving others and giving back to the community as a foundational principle.' },
  { name: 'Family Focus', text: 'Recognizing the importance of strong family ties and encouraging members to prioritize their families in all endeavors.' },
  { name: 'Respect & Inclusivity', text: 'Valuing diverse perspectives and promoting an environment of mutual respect among all members.' }
];

export const PAST_IMPACT = [
  'Community Chili Cook-Off Fundraiser',
  'Partnership with Texas Bank for the Christmas Angel Tree Program',
  'Dunk Tank Charity Event supporting the owner of Charm Coffee following his hospitalization',
  '1st annual Coyote Cruisers Car & Bike Show benefiting Coyote Packs',
  'Gun Raffles',
  "2nd annual Coyote Cruisers Car and Bike Show benefiting Coyote Packs, Sleep in Heavenly Peace, and Teacher's Closet",
  'Partnership with Anna Walks For a Cause'
];

/** Site photos (HTML/images/, served at /content/images/). */
export const PHOTOS = {
  carshow: { src: '/content/images/carshow.jpg', alt: 'Classic cars lined up at the Coyote Cruisers Car & Bike Show in Anna' },
  booth: { src: '/content/images/booth.jpg', alt: 'MMoA members at their event booth' },
  volunteers: { src: '/content/images/volunteers.jpg', alt: 'Volunteers and members at the car show' },
  fundraiser: { src: '/content/images/fundraiser.jpg', alt: 'Volunteers serving desserts at a fundraiser' },
  legion: { src: '/content/images/legion.jpg', alt: 'Members with American Legion Post 194 in Anna' },
  group: { src: '/content/images/group.jpg', alt: 'MMoA members and volunteers together at the car show' },
  angeltree: { src: '/content/images/angeltree.jpg', alt: 'Bikes and gifts collected around the Christmas Angel Tree at Texas Bank in Anna' }
};
