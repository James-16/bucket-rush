/** Neon-minimal palette. Bucket hues stay consistent with Buckets & Brackets. */
export const NEON = {
  bg: 0x07070f,
  panel: 0x0d0e1a,
  grid: 0x1c2136,
  ink: 0xe8f6ff,
  dim: 0x5a6b8c,

  traditional: 0x4aa8ff, // IOU Tank
  roth: 0x2bff9e, // Freedom Tank
  taxable: 0xffd94a, // Wallet
  spouse: 0xb28bff, // Offshore Vault
  kids: 0xff7ad9, // Kid Jar

  sam: 0xff9e5e, // lovable bureaucrat orange
  tax: 0xff5470,
  good: 0x2bff9e,
  warn: 0xffd94a,
};

export const BUCKET_STYLE = [
  { key: "traditional", label: "IOU TANK", color: NEON.traditional, note: "Sam owns a slice" },
  { key: "roth", label: "FREEDOM TANK", color: NEON.roth, note: "Sam can't touch it" },
  { key: "taxable", label: "WALLET", color: NEON.taxable, note: "handy, drips a little" },
  { key: "spouse", label: "OFFSHORE VAULT", color: NEON.spouse, note: "outside Sam's kingdom" },
  { key: "kids", label: "KID JAR", color: NEON.kids, note: "school money" },
] as const;
