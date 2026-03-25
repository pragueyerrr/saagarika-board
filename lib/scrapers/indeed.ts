import { XMLParser } from 'fast-xml-parser'
import type { Job, JobSource } from '@/types'

const INDEED_RSS_QUERIES_DUBAI = [
  // Core data analyst
  { q: 'data+analyst', label: 'Data Analyst' },
  { q: 'junior+data+analyst', label: 'Junior Data Analyst' },
  { q: 'senior+data+analyst', label: 'Senior Data Analyst' },
  // Business & commercial
  { q: 'business+analyst', label: 'Business Analyst' },
  { q: 'commercial+analyst', label: 'Commercial Analyst' },
  { q: 'financial+analyst', label: 'Financial Analyst' },
  { q: 'revenue+analyst', label: 'Revenue Analyst' },
  // Research & insights
  { q: 'research+analyst', label: 'Research Analyst' },
  { q: 'insights+analyst', label: 'Insights Analyst' },
  { q: 'market+research+analyst', label: 'Market Research Analyst' },
  { q: 'consumer+insights', label: 'Consumer Insights Analyst' },
  { q: 'customer+insights+analyst', label: 'Customer Insights Analyst' },
  { q: 'UX+researcher', label: 'UX Researcher' },
  // BI & reporting
  { q: 'business+intelligence+analyst', label: 'BI Analyst' },
  { q: 'BI+analyst', label: 'BI Analyst' },
  { q: 'reporting+analyst', label: 'Reporting Analyst' },
  // Data science
  { q: 'data+scientist', label: 'Data Scientist' },
  // Analytics & insights management
  { q: 'analytics+manager', label: 'Analytics Manager' },
  { q: 'insights+manager', label: 'Insights Manager' },
  // Strategy & product
  { q: 'strategy+analyst', label: 'Strategy Analyst' },
  { q: 'product+analyst', label: 'Product Analyst' },
  { q: 'growth+analyst', label: 'Growth Analyst' },
  { q: 'operations+analyst', label: 'Operations Analyst' },
]

// Remote full-time data roles
const INDEED_RSS_QUERIES_REMOTE = [
  { q: 'data+analyst+remote', label: 'Data Analyst Remote' },
  { q: 'business+analyst+remote', label: 'Business Analyst Remote' },
  { q: 'research+analyst+remote', label: 'Research Analyst Remote' },
  { q: 'insights+analyst+remote', label: 'Insights Analyst Remote' },
  { q: 'data+scientist+remote', label: 'Data Scientist Remote' },
  { q: 'BI+analyst+remote', label: 'BI Analyst Remote' },
  { q: 'product+analyst+remote', label: 'Product Analyst Remote' },
]

// Phrases that indicate residency requirements incompatible with a Dubai golden visa
const EXCLUSION_PHRASES = [
  'us citizen',
  'us citizenship',
  'u.s. citizen',
  'us work authorization',
  'must be authorized to work in the united states',
  'authorized to work in the us',
  'green card',
  'security clearance',
  'secret clearance',
  'top secret',
  'dod clearance',
  'must reside in',
  'must be based in the us',
  'must be a us resident',
]

function isExcluded(text: string): boolean {
  const lower = text.toLowerCase()
  return EXCLUSION_PHRASES.some((phrase) => lower.includes(phrase))
}

interface RSSItem {
  title: string
  link: string
  description?: string
  pubDate?: string
  source?: { '#text'?: string; _name?: string }
  guid?: string | { '#text': string }
}

interface RSSFeed {
  rss?: { channel?: { item?: RSSItem | RSSItem[] } }
}

async function fetchIndeedRSS(q: string, location?: string): Promise<RSSItem[]> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '_' })
  const locationParam = location ? `&l=${encodeURIComponent(location)}&radius=25` : '&remotejobs=1'
  const url = `https://www.indeed.com/rss?q=${q}${locationParam}&sort=date`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAggregator/1.0; personal use)' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return []
  const xml = await res.text()
  const feed: RSSFeed = parser.parse(xml)
  const items = feed.rss?.channel?.item
  return Array.isArray(items) ? items : items ? [items] : []
}

function processSettled(
  settled: PromiseSettledResult<RSSItem[]>[],
  seen: Set<string>,
  allJobs: Omit<Job, 'id' | 'scraped_at'>[],
  defaultLocation: string
) {
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const item of result.value) {
      const link = typeof item.link === 'string' ? item.link : String(item.link ?? '')
      const guid = typeof item.guid === 'string' ? item.guid : item.guid?.['#text'] ?? link

      if (seen.has(guid)) continue

      const rawDesc = item.description ?? ''
      const description = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

      if (isExcluded(`${item.title ?? ''} ${description}`)) continue

      seen.add(guid)

      const titleParts = (item.title ?? '').split(' - ')
      const title = titleParts[0]?.trim() ?? item.title
      const company =
        titleParts.length > 1 ? titleParts[titleParts.length - 1]?.trim() : undefined

      allJobs.push({
        external_id: guid,
        source: 'indeed_rss' as JobSource,
        title,
        company,
        location: defaultLocation,
        description,
        job_url: link,
        posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
        is_active: true,
      })
    }
  }
}

export async function scrapeIndeedRSS(): Promise<Omit<Job, 'id' | 'scraped_at'>[]> {
  const allJobs: Omit<Job, 'id' | 'scraped_at'>[] = []
  const seen = new Set<string>()

  // Dubai-based queries
  for (let i = 0; i < INDEED_RSS_QUERIES_DUBAI.length; i += 5) {
    const batch = INDEED_RSS_QUERIES_DUBAI.slice(i, i + 5)
    const settled = await Promise.allSettled(batch.map(({ q }) => fetchIndeedRSS(q, 'Dubai, UAE')))
    processSettled(settled, seen, allJobs, 'Dubai, UAE')
  }

  // Remote queries
  for (let i = 0; i < INDEED_RSS_QUERIES_REMOTE.length; i += 5) {
    const batch = INDEED_RSS_QUERIES_REMOTE.slice(i, i + 5)
    const settled = await Promise.allSettled(batch.map(({ q }) => fetchIndeedRSS(q)))
    processSettled(settled, seen, allJobs, 'Remote')
  }

  return allJobs
}
