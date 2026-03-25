import type { Job, JobSource } from '@/types'

// Remotive public API — no key required
const REMOTIVE_BASE = 'https://remotive.com/api/remote-jobs'

const DATA_CATEGORIES = ['data', 'business', 'finance']

interface RemotiveJob {
  id: number
  url: string
  title: string
  company_name: string
  category: string
  tags: string[]
  job_type: string
  publication_date: string
  description: string
  salary: string
}

interface RemotiveResponse {
  jobs: RemotiveJob[]
}

const ROLE_KEYWORDS = [
  'data analyst', 'business analyst', 'research analyst', 'insights analyst',
  'bi analyst', 'business intelligence', 'data scientist', 'analytics',
  'market research', 'reporting analyst', 'product analyst', 'strategy analyst',
  'financial analyst', 'commercial analyst', 'operations analyst', 'growth analyst',
  'ux researcher', 'consumer insights', 'customer insights',
]

const EXCLUSION_PHRASES = [
  'us citizen', 'us citizenship', 'u.s. citizen', 'us work authorization',
  'must be authorized to work in the united states', 'authorized to work in the us',
  'green card', 'security clearance', 'secret clearance', 'top secret', 'dod clearance',
  'must reside in', 'must be based in the us', 'must be a us resident',
]

function isDataRole(title: string): boolean {
  const t = title.toLowerCase()
  return ROLE_KEYWORDS.some((kw) => t.includes(kw))
}

function isExcluded(text: string): boolean {
  const lower = text.toLowerCase()
  return EXCLUSION_PHRASES.some((phrase) => lower.includes(phrase))
}

async function fetchRemotiveCategory(category: string): Promise<RemotiveJob[]> {
  const res = await fetch(`${REMOTIVE_BASE}?category=${category}&limit=100`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return []
  const data: RemotiveResponse = await res.json()
  return data.jobs ?? []
}

export async function scrapeRemotive(): Promise<Omit<Job, 'id' | 'scraped_at'>[]> {
  const seen = new Set<string>()
  const allJobs: Omit<Job, 'id' | 'scraped_at'>[] = []

  const settled = await Promise.allSettled(
    DATA_CATEGORIES.map((cat) =>
      fetchRemotiveCategory(cat).catch((err) => {
        console.error(`Remotive error for category "${cat}":`, err)
        return []
      })
    )
  )

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const job of result.value) {
      const key = String(job.id)
      if (seen.has(key)) continue
      if (!isDataRole(job.title)) continue
      if (isExcluded(`${job.title} ${job.description ?? ''}`)) continue

      seen.add(key)

      allJobs.push({
        external_id: `remotive_${job.id}`,
        source: 'manual' as JobSource,
        title: job.title,
        company: job.company_name,
        location: 'Remote',
        description: job.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
        job_url: job.url,
        job_type: job.job_type,
        salary_range: job.salary || undefined,
        posted_at: job.publication_date ? new Date(job.publication_date).toISOString() : undefined,
        is_active: true,
        raw_data: { remotive: true },
      })
    }
  }

  return allJobs
}
