// Static autocomplete suggestions — ported from intelli-search/frontend/src/services/api.ts
export const SUGGESTION_LIST: string[] = [
  'tech companies in California',
  'healthcare companies in London',
  'software companies in San Francisco',
  'AI companies in Seattle',
  'biotech companies in Boston',
  'cybersecurity companies',
  'companies that raised Series B funding',
  'companies with recent IPO',
  'renewable energy companies',
  'manufacturing companies in Germany',
  'media companies in Los Angeles',
  'consulting firms in Chicago',
  'retail companies in UK',
  'companies in Australia',
  'telecommunications companies',
  'find me companies that announced fund raising in last year in Australia',
  'give me more information about Infosys',
];

export function suggestFromList(query: string, limit = 6): string[] {
  const q = query.toLowerCase().trim();
  if (!q || q.length < 2) return [];
  return SUGGESTION_LIST.filter((s) => s.toLowerCase().includes(q)).slice(0, limit);
}
