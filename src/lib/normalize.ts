const special: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/** Shared normalization for airport names, codes, and search queries. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[øæœßłđðþı]/g, (c) => special[c])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  return normalizeText(s).split(' ').filter(Boolean);
}
