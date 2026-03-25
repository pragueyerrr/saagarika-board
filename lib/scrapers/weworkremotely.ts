import { XMLParser } from 'fast-xml-parser'
import type { Job, JobSource } from '@/types'

// We Work Remotely — free public RSS feeds, no key required
const WWR_FEEDS = [
  'https://weworkremotely.com/categories/remote-data-science-jobs.rss',
  'https://weworkremotely.com/categories/remote-finance-legal-jobs.rss',
  'https://weworkremotely.com/categories/remote-management-finance-jobs.rss',
]

const ROLE_KEYWORDS = [
  'data analyst', 'business analyst', 'research analyst', 'insights analyst',
  'bi analyst', 'business intelligence', 'data scientist', 'analytics',
  'market research', 'reporting analyst', 'product analyst', 'strategy analyst',
  'financial analyst', 'commercial analyst', 'operations analyst',
]

const EXCLUSION_PHRASES = [
  'us citizen', 'us citizenship', 'u.s. citizen', 'us work authorization',
  'must be authorized to work in the united states', 'authorized to work in the us',
  'green card', 'security clearance', 'secret clearance', 'top secret', 'dod clearance',
  'must reside in', 'must be based in the us', 'must be a us resident',
  'us only', 'usa only', 'united states only',
]

function isDataRole(title: string): boolean {
  const t = title.toLowerCase()
  return ROLE_KEYWORDS.some((kw) => t.includes(kw))
}

function isExcluded(text: string): boolean {
  const lower = text.toLowerCase()
  return EXCLUSION_PHRASES.some((phrase) => lower.includes(phrase))
}

interface RSSItem {
  title: string | { '#text': string }
  link: string
  description?: string
  pubDate?: string
  guid?: string | { '#text': string }
}

interface RSSFeed {
  rss?: { channel?: { item?: RSSItem | RSSItem[] } }
}

async function fetchWWRFeed(url: string): Promise<RSSItem[]> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '_' })
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAggregator/1.0; personal use)' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return []
  const xml = await res.text()
  const feed: RSSFeed = parser.parse(xml)
  const items = feed.rss?.channel?.item
  return Array.isArray(items) ? items : items ? [items] : []
}

export async function scrapeWeWorkRemotely(): Promise<Omit<Job, 'id' | 'scraped_at'>[]> {
  const seen = new Set<string>()
  const allJobs: Omit<Job, 'id' | 'scraped_at'>[] = []

  const settled = await Promise.allSettled(
    WWR_FEEDS.map((url) =>
      fetchWWRFeed(url).catch((err) => {
        console.error(`WWR error for "${url}":`, err)
        return []
      })
    )
  )

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const item of result.value) {
      const rawTitle = typeof item.title === 'string' ? item.title : item.title?.['#text'] ?? ''
      // WWR titles are "Company: Job Title" — split them
      const colonIdx = rawTitle.indexOf(':')
      const company = colonIdx > -1 ? rawTitle.slice(0, colonIdx).trim() : undefined
      const title = colonIdx > -1 ? rawTitle.slice(colonIdx + 1).trim() : rawTitle.trim()

      // Feed already scoped to data/finance categories — skip title filter
      if (!title) continue

      const link = typeof item.link === 'string' ? item.link : ''
      const guid = typeof item.guid === 'string' ? item.guid : item.guid?.['#text'] ?? link
      if (seen.has(guid)) continue

      const rawDesc = item.description ?? ''
      const description = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (isExcluded(`${title} ${description}`)) continue

      seen.add(guid)

      allJobs.push({
        external_id: `wwr_${Buffer.from(guid).toString('base64').slice(0, 24)}`,
        source: 'manual' as JobSource,
        title,
        company,
        location: 'Remote',
        description: description.slice(0, 2000),
        job_url: link,
        posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
        is_active: true,
        raw_data: { wwr: true },
      })
    }
  }

  return allJobs
}
