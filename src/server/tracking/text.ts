export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/u\/[a-z0-9_-]+/g, " ")
    .replace(/r\/[a-z0-9_]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameAliases(name: string): string[] {
  const normalized = normalizeText(name);
  const aliases = new Set<string>([normalized, normalized.replace(/ and /g, " ")]);

  if (normalized.startsWith("the ")) {
    aliases.add(normalized.slice(4));
  }

  return [...aliases].filter(Boolean).sort();
}

export function extractContributors(...values: (string | undefined)[]): string[] {
  const usernames = new Set<string>();
  const text = values.filter(Boolean).join("\n");
  const pattern =
    /(?:dared\s*by|daredby|dared-by)\s*:?\s*`?\s*(?:\/?u\/)([a-zA-Z0-9_-]{3,20})/gi;

  for (const match of text.matchAll(pattern)) {
    if (match[1]) usernames.add(match[1]);
  }

  return [...usernames].sort((a, b) => a.localeCompare(b));
}

export function hasContributorUser(...values: (string | undefined)[]): boolean {
  return extractContributors(...values).length > 0;
}

// Backwards-compatible aliases while callsites migrate to neutral names.
export const extractDaredBy = extractContributors;
export const hasDaredByUser = hasContributorUser;

export function communityDareNameFromTitle(title: string): string {
  const stripped = title
    .replace(
      /(?:[-\u2013\u2014|:()[\]\s]*)?(?:dared\s*by|daredby|dared-by)\s*:?\s*`?\s*(?:\/?u\/)[a-zA-Z0-9_-]{3,20}`?/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  return stripped || title;
}
