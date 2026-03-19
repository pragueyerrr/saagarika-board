import * as cheerio from 'cheerio'
import type { Job, JobSource } from '@/types'

// Direct employer career pages - Dubai tech, fintech, and enterprise companies with PM roles
const EMPLOYER_SITES = [
  // Major tech / super-apps
  {
    name: 'Careem',
    url: 'https://www.careem.com/en-ae/careers/',
    source: 'careem',
    selectors: {
      item: '.job, .career, .position, article, .vacancy, [class*="job"], [class*="career"], [class*="position"]',
      title: 'h1, h2, h3, h4, a, .title, [class*="title"]',
      link: 'a',
    },
  },
  {
    name: 'Noon',
    url: 'https://www.noon.com/uae-en/careers/',
    source: 'noon',
    selectors: {
      item: '.job, .career, .position, article, [class*="job"], [class*="career"]',
      title: 'h2, h3, h4, a, .title, [class*="title"]',
      link: 'a',
    },
  },
  // Fintech
  {
    name: 'Tabby',
    url: 'https://tabby.ai/careers',
    source: 'tabby',
    selectors: {
      item: '.job, .career, .position, article, [class*="job"], [class*="career"]',
      title: 'h2, h3, h4, .title, [class*="title"]',
      link: 'a',
    },
  },
  {
    name: 'Tamara',
    url: 'https://tamara.co/careers',
    source: 'tamara',
    selectors: {
      item: '.job, .career, .position, article, .vacancy, [class*="job"]',
      title: 'h2, h3, h4, a, .title, [class*="title"]',
      link: 'a',
    },
  },
  {
    name: 'Ziina',
    url: 'https://ziina.com/careers',
    source: 'ziina',
    selectors: {
      item: '.job, .career, .position, article, [class*="job"], [class*="career"]',
      title: 'h2, h3, h4, a, .title, [class*="title"]',
      link: 'a',
    },
  },
  // Enterprise / consulting
  {
    name: 'Chalhoub Group',
    url: 'https://www.chalhoubgroup.com/careers',
    source: 'chalhoub',
    selectors: {
      item: '.job, .career, .position, article, [class*="job"]',
      title: 'h2, h3, h4, a, .title, [class*="title"]',
      link: 'a',
    },
  },
  {
    name: 'Majid Al Futtaim',
    url: 'https://www.majidalfuttaim.com/en/careers',
    source: 'maf',
    selectors: {
      item: '.job, .career, .vacancy, article, [class*="job"], [class*="career"]',
      title: 'h2, h3, h4, a, .title, [class*="title"]',
      link: 'a',
    },
  },
  // Real estate / smart city
  {
    name: 'Emaar',
    url: 'https://www.emaar.com/en/careers/',
    source: 'emaar',
    selectors: {
      item: '.job, .career, .vacancy, article, [class*="job"], [class*="career"]',
      title: 'h2, h3, h4, .title, [class*="title"]',
      link: 'a',
    },
  },
  {
    name: 'DEWA',
    url: 'https://www.dewa.gov.ae/en/about-dewa/careers',
    source: 'dewa',
    selectors: {
      item: '.job, .career, .position, article, [class*="job"], [class*="career"]',
      title: 'h2, h3, h4, a, .title, [class*="title"]',
      link: 'a',
    },
  },
  // Hospitality / travel tech
  {
    name: 'Jumeirah Group',
    url: 'https://www.jumeirah.com/en/jumeirah-group/careers',
    source: 'jumeirah',
    selectors: {
      item: '.job-listing, .career-item, article, .position, [class*="job"]',
      title: 'h2, h3, h4, .title, [class*="title"]',
      link: 'a',
    },
  },
  // Telecoms
  {
    name: 'du Telecom',
    url: 'https://www.du.ae/careers',
    source: 'du_telecom',
    selectors: {
      item: '.job, .career, .position, article, [class*="job"], [class*="career"]',
      title: 'h2, h3, h4, a, .title, [class*="title"]',
      link: 'a',
    },
  },
  // Government / smart city
  {
    name: 'Smart Dubai',
    url: 'https://www.smartdubai.ae/careers',
    source: 'smart_dubai',
    selectors: {
      item: '.job, .career, .vacancy, article, [class*="job"]',
      title: 'h2, h3, h4, a, .title, [class*="title"]',
      link: 'a',
    },
  },
]

const PM_KEYWORDS = [
  'product manager', 'product owner', 'scrum master', 'agile',
  'business analyst', 'product analyst', 'product strategy',
  'product operations', 'product ops', 'program manager',
  'project manager', 'delivery manager', 'portfolio manager',
  'growth manager', 'growth product', 'technical product',
  'platform product', 'data product', 'ux researcher',
  'user researcher', 'ux strategist', 'product lead',
  'head of product', 'vp product', 'chief product',
  'director of product', 'roadmap', 'sprint', 'backlog',
]

function isCreativeRole(title: string): boolean {
  const t = title.toLowerCase()
  return PM_KEYWORDS.some((kw) => t.includes(kw))
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
      signal: AbortSignal.timeout(12000),
    })

    if (!res.ok) {
      console.warn(`${employer.name} returned ${res.status}`)
      return []
    }

    const html = await res.text()
    const $ = cheerio.load(html)
    const seen = new Set<string>()

    // Try to find job listings using the configured selectors
    $(employer.selectors.item).each((_, el) => {
      const $el = $(el)

      // Find title
      const titleEl = $el.find(employer.selectors.title).first()
      const title = titleEl.text().trim() || $el.text().trim().split('\n')[0]?.trim()

      if (!title || title.length < 5 || title.length > 150) return
      if (seen.has(title)) return

      // Only include creative-adjacent roles
      if (!isCreativeRole(title)) return

      seen.add(title)

      // Find link
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

      // Find any additional detail text
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

    // Fallback: if no items found via selectors, scan all links for job-like text
    if (jobs.length === 0) {
      $('a').each((_, el) => {
        const $el = $(el)
        const text = $el.text().trim()
        const href = $el.attr('href') ?? ''

        if (!text || text.length < 5 || text.length > 120) return
        if (!isCreativeRole(text)) return
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

export async function scrapeEmployerSites(): Promise<
  Omit<Job, 'id' | 'scraped_at'>[]
> {
  const results = await Promise.allSettled(
    EMPLOYER_SITES.map((e) => scrapeEmployerSite(e))
  )

  return results.flatMap((r) =>
    r.status === 'fulfilled' ? r.value : []
  )
}
