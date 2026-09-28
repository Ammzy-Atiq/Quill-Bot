/**
 * Brand tokens sampled from the QUILL GUARD logo (assets/brand/quill-logo.webp).
 * The bot never uses these as a Components V2 accent colour (no side bar rule) —
 * they exist for the website and for generated images.
 */
export const BRAND = {
  name: 'QUILL GUARD',
  shortName: 'QUILL',
  author: 'Atiq Ur Rahman',
  tagline: 'Advanced server security — AutoMod, Verification & Anti-Nuke.',
  logoPath: 'assets/brand/quill-logo.webp',
  colors: {
    /** Page background (logo background). */
    ink: '#000712',
    /** Raised surfaces / cards on the dark background. */
    surface: '#0A1220',
    /** Borders and dividers on dark surfaces. */
    line: '#1B2536',
    /** Primary text on dark backgrounds. */
    text: '#F4F1EA',
    /** Secondary text. */
    muted: '#8C96A8',
    /** Brightest quill highlight. */
    gold: '#F2AC2B',
    /** Mid-tone of the quill gradient. */
    amber: '#D98A1A',
    /** Deep end of the quill gradient. */
    ember: '#B4550A',
    success: '#3FB67B',
    danger: '#E5484D',
  },
  gradient: 'linear-gradient(135deg, #F2AC2B 0%, #D98A1A 50%, #B4550A 100%)',
} as const;

export type BrandColor = keyof typeof BRAND.colors;
