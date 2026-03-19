import { XMLParser } from 'fast-xml-parser'
import type { Job, JobSource } from '@/types'

const INDEED_RSS_QUERIES = [
  // Core social media
  { q: 'social+media+manager', label: 'Social Media Manager' },
  { q: 'social+media+strategist', label: 'Social Media Strategist' },
  { q: 'social+media+coordinator', label: 'Social Media Coordinator' },
  { q: 'social+media+assistant', label: 'Social Media Assistant' },
  { q: 'social+media+specialist', label: 'Social Media Specialist' },
  { q: 'head+of+social+media', label: 'Head of Social Media' },
  // Performance marketing
  { q: 'performance+marketing+manager', label: 'Performance Marketing Manager' },
  { q: 'performance+marketing+specialist', label: 'Performance Marketing Specialist' },
  { q: 'paid+social+manager', label: 'Paid Social Manager' },
  { q: 'paid+media+manager', label: 'Paid Media Manager' },
  { q: 'PPC+manager', label: 'PPC Manager' },
  // Digital marketing
  { q: 'digital+marketing+manager', label: 'Digital Marketing Manager' },
  { q: 'digital+marketing+specialist', label: 'Digital Marketing Specialist' },
  { q: 'growth+marketing+manager', label: 'Growth Marketing Manager' },
  // Content & brand
  { q: 'content+marketing+manager', label: 'Content Marketing Manager' },
  { q: 'content+strategist', label: 'Content Strategist' },
  { q: 'brand+manager', label: 'Brand Manager' },
  // General marketing
  { q: 'marketing+manager', label: 'Marketing Manager' },
  { q: 'marketing+coordinator', label: 'Marketing Coordinator' },
  { q: 'marketing+assistant', label: 'Marketing Assistant' },
  // Reach roles
  { q: 'head+of+marketing', label: 'Head of Marketing' },
  { q: 'marketing+director', label: 'Marketing Director' },
  { q: 'CRM+manager', label: 'CRM Manager' },
  { q: 'email+marketing+manager', label: 'Email Marketing Manager' },
  { q: 'media+planner', label: 'Media Planner' },
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
