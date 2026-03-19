import { XMLParser } from 'fast-xml-parser'
import type { Job, JobSource } from '@/types'

const INDEED_RSS_QUERIES = [
  // Core PM
  { q: 'product+manager', label: 'Product Manager' },
  { q: 'senior+product+manager', label: 'Senior Product Manager' },
  { q: 'lead+product+manager', label: 'Lead Product Manager' },
  { q: 'head+of+product', label: 'Head of Product' },
  { q: 'director+of+product', label: 'Director of Product' },
  { q: 'VP+product', label: 'VP of Product' },
  // Adjacent PM
  { q: 'product+owner', label: 'Product Owner' },
  { q: 'scrum+master', label: 'Scrum Master' },
  { q: 'agile+coach', label: 'Agile Coach' },
  { q: 'agile+project+manager', label: 'Agile Project Manager' },
  // Business & analysis
  { q: 'business+analyst', label: 'Business Analyst' },
  { q: 'product+analyst', label: 'Product Analyst' },
  { q: 'product+strategy', label: 'Product Strategy' },
  { q: 'product+operations', label: 'Product Operations' },
  // Technical PM
  { q: 'technical+product+manager', label: 'Technical Product Manager' },
  { q: 'platform+product+manager', label: 'Platform Product Manager' },
  { q: 'growth+product+manager', label: 'Growth PM' },
  // Program & project
  { q: 'program+manager', label: 'Program Manager' },
  { q: 'project+manager', label: 'Project Manager' },
  { q: 'delivery+manager', label: 'Delivery Manager' },
  // Data & growth
  { q: 'data+product+manager', label: 'Data Product Manager' },
  { q: 'growth+manager', label: 'Growth Manager' },
  // UX adjacent
  { q: 'UX+researcher', label: 'UX Researcher' },
  { q: 'user+researcher', label: 'User Researcher' },
]

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

async function fetchIndeedRSS(q: string): Promise<RSSItem[]> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '_' })
  const url = `https://www.indeed.com/rss?q=${q}&l=Dubai%2C+UAE&radius=25&sort=date`
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

export async function scrapeIndeedRSS(): Promise<Omit<Job, 'id' | 'scraped_at'>[]> {
  const allJobs: Omit<Job, 'id' | 'scraped_at'>[] = []
  const seen = new Set<string>()

  // Run all queries in parallel batches of 5
  for (let i = 0; i < INDEED_RSS_QUERIES.length; i += 5) {
    const batch = INDEED_RSS_QUERIES.slice(i, i + 5)
    const settled = await Promise.allSettled(batch.map(({ q }) => fetchIndeedRSS(q)))

    for (const result of settled) {
      if (result.status !== 'fulfilled') continue
      for (const item of result.value) {
        const link = typeof item.link === 'string' ? item.link : String(item.link ?? '')
        const guid = typeof item.guid === 'string' ? item.guid : item.guid?.['#text'] ?? link

        if (seen.has(guid)) continue
        seen.add(guid)

        const rawDesc = item.description ?? ''
        const description = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

        const titleParts = (item.title ?? '').split(' - ')
        const title = titleParts[0]?.trim() ?? item.title
        const company =
          titleParts.length > 1 ? titleParts[titleParts.length - 1]?.trim() : undefined

        allJobs.push({
          external_id: guid,
          source: 'indeed_rss' as JobSource,
          title,
          company,
          location: 'Dubai, UAE',
          description,
          job_url: link,
          posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
          is_active: true,
        })
      }
    }
  }

  return allJobs
}
