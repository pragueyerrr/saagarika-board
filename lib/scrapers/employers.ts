import * as cheerio from 'cheerio'
import type { Job, JobSource } from '@/types'

// Only employer sites confirmed to serve static HTML that Vercel can reach
const EMPLOYER_SITES = [
  {
    name: 'PwC Middle East',
    url: 'https://www.pwc.com/m1/en/careers.html',
    source: 'pwc_me',
    selectors: {
      item: '.job, .career, article, [class*="job"]',
      title: 'h2, h3, h4, a, .title',
      link: 'a',
    },
  },
  {
    name: 'Deloitte Middle East',
    url: 'https://apply.deloitte.com/careers/SearchJobs/?3_94_3=6263',
    source: 'deloitte_me',
    selectors: {
      item: '.job, .career, article, [class*="job"], tr',
      title: 'h2, h3, h4, a, td, .title',
      link: 'a',
    },
  },
  {
    name: 'Tabby',
    url: 'https://tabby.ai/en-AE/careers',
    source: 'tabby',
    selectors: {
      item: '.job, article, [class*="job"], [class*="position"]',
      title: 'h2, h3, h4, a, .title',
      link: 'a',
    },
  },
  {
    name: 'KPMG Lower Gulf',
    url: 'https://home.kpmg/ae/en/home/careers.html',
    source: 'kpmg_ae',
    selectors: {
      item: '.job, article, [class*="job"], [class*="opening"]',
      title: 'h2, h3, h4, a, .title',
      link: 'a',
    },
  },
  {
    name: 'Oliver Wyman',
    url: 'https://www.oliverwyman.com/careers.html',
    source: 'oliver_wyman',
    selectors: {
      item: '.job, article, [class*="job"], [class*="role"]',
      title: 'h2, h3, h4, a, .title',
      link: 'a',
    },
  },
]

const DATA_KEYWORDS = [
  'data analyst',
  'data analysis',
  'business analyst',
  'business analysis',
  'research analyst',
  'insights analyst',
  'market research',
  'consumer insights',
  'customer insights',
  'ux research',
  'ux researcher',
  'bi analyst',
  'business intelligence',
  'reporting analyst',
  'data scientist',
  'analytics',
  'data manager',
  'insights manager',
  'strategy analyst',
  'commercial analyst',
  'financial analyst',
  'product analyst',
  'growth analyst',
  'operations analyst',
  'revenue analyst',
  'sql',
  'tableau',
  'power bi',
  'looker',
]

function isDataRole(title: string): boolean {
  const t = title.toLowerCase()
  return DATA_KEYWORDS.some((kw) => t.includes(kw))
}

async function scrapeEmployerSite(
  employer: (typeof EMPLOYER_SITES)[0]
): Promise<Omit<Job, 'id' | 'scraped_at'>[]> {
  const jobs: Omit<Job, 'id' | 'scraped_at'>[] = []

  try {
    const res = await fetch(employer.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      console.warn(`${employer.name} returned ${res.status}`)
      return []
    }

    const html = await res.text()
    const $ = cheerio.load(html)
    const seen = new Set<string>()

    $(employer.selectors.item).each((_, el) => {
      const $el = $(el)
      const titleEl = $el.find(employer.selectors.title).first()
      const title = titleEl.text().trim() || $el.text().trim().split('\n')[0]?.trim()

      if (!title || title.length < 5 || title.length > 150) return
      if (seen.has(title)) return
      if (!isDataRole(title)) return

      seen.add(title)

      const linkEl = $el.find(employer.selectors.link).first()
      const relLink = linkEl.attr('href') ?? ''
      let jobUrl = employer.url
      if (relLink) {
        jobUrl = relLink.startsWith('http')
          ? relLink
          : relLink.startsWith('/')
          ? new URL(relLink, employer.url).href
          : employer.url
      }

      const description = $el.text().replace(title, '').trim().slice(0, 500) || undefined

      jobs.push({
        external_id: `${employer.source}_${Buffer.from(title).toString('base64').slice(0, 20)}`,
        source: 'manual' as JobSource,
        title,
        company: employer.name,
        location: 'Dubai, UAE',
        description,
        job_url: jobUrl,
        is_active: true,
        raw_data: { employer_source: employer.source },
      })
    })

    // Fallback: scan all links
    if (jobs.length === 0) {
      $('a').each((_, el) => {
        const $el = $(el)
        const text = $el.text().trim()
        const href = $el.attr('href') ?? ''

        if (!text || text.length < 5 || text.length > 120) return
        if (!isDataRole(text)) return
        if (seen.has(text)) return
        seen.add(text)

        const jobUrl = href.startsWith('http')
          ? href
          : href.startsWith('/')
          ? new URL(href, employer.url).href
          : employer.url

        jobs.push({
          external_id: `${employer.source}_link_${Buffer.from(text).toString('base64').slice(0, 20)}`,
          source: 'manual' as JobSource,
          title: text,
          company: employer.name,
          location: 'Dubai, UAE',
          job_url: jobUrl,
          is_active: true,
          raw_data: { employer_source: employer.source },
        })
      })
    }
  } catch (err) {
    console.error(`${employer.name} scrape error:`, err)
  }

  return jobs
}

export async function scrapeEmployerSites(): Promise<Omit<Job, 'id' | 'scraped_at'>[]> {
  const results = await Promise.allSettled(
    EMPLOYER_SITES.map((e) => scrapeEmployerSite(e))
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}
