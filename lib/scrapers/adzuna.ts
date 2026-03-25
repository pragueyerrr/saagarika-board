import type { Job, JobSource } from '@/types'

const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs/ae/search'
const ADZUNA_BASE_GLOBAL = 'https://api.adzuna.com/v1/api/jobs/gb/search' // for remote roles

const DATA_CATEGORIES = [
  // Core data analyst roles
  'data analyst',
  'junior data analyst',
  'senior data analyst',
  'lead data analyst',
  // Business & commercial analyst
  'business analyst',
  'commercial analyst',
  'financial analyst',
  'revenue analyst',
  // Research & insights
  'research analyst',
  'insights analyst',
  'market research analyst',
  'consumer insights analyst',
  'customer insights analyst',
  'UX researcher',
  // BI & reporting
  'business intelligence analyst',
  'BI analyst',
  'reporting analyst',
  'data and insights analyst',
  // Data science (adjacent)
  'data scientist',
  'junior data scientist',
  // Analytics management
  'analytics manager',
  'data manager',
  'insights manager',
  // Strategy & operations
  'strategy analyst',
  'operations analyst',
  'growth analyst',
  'product analyst',
]

// Phrases that indicate the role requires residency/authorization incompatible with a Dubai golden visa
const EXCLUSION_PHRASES = [
  'us citizen',
  'us citizenship',
  'u.s. citizen',
  'u.s. citizenship',
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
  'must be located in the us',
  'must be a us resident',
]

function isExcluded(job: { title: string; description?: string }): boolean {
  const text = `${job.title} ${job.description ?? ''}`.toLowerCase()
  return EXCLUSION_PHRASES.some((phrase) => text.includes(phrase))
}

interface AdzunaResult {
  id: string
  title: string
  company: { display_name: string }
  location: { display_name: string }
  description: string
  redirect_url: string
  salary_min?: number
  salary_max?: number
  contract_time?: string
  created: string
}

interface AdzunaResponse {
  results: AdzunaResult[]
  count: number
}

async function fetchAdzunaTerm(
  term: string,
  appId: string,
  appKey: string,
  baseUrl: string = ADZUNA_BASE,
  where: string = 'dubai'
): Promise<AdzunaResult[]> {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: '20',
    what: term,
    where,
    'content-type': 'application/json',
  })
  const res = await fetch(`${baseUrl}/1?${params}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return []
  const data: AdzunaResponse = await res.json()
  return data.results ?? []
}

async function runInBatches<T>(
  items: string[],
  batchSize: number,
  fn: (item: string) => Promise<T[]>
): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const settled = await Promise.allSettled(batch.map(fn))
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value)
    }
  }
  return results
}

export async function scrapeAdzuna(): Promise<Omit<Job, 'id' | 'scraped_at'>[]> {
  const appId = process.env.ADZUNA_APP_ID
  const appKey = process.env.ADZUNA_APP_KEY

  if (!appId || !appKey) {
    console.warn('Adzuna credentials missing — skipping Adzuna scrape')
    return []
  }

  const seen = new Set<string>()

  // Dubai-based roles
  const dubaiResults = await runInBatches(DATA_CATEGORIES, 5, (term) =>
    fetchAdzunaTerm(term, appId, appKey, ADZUNA_BASE, 'dubai').catch((err) => {
      console.error(`Adzuna (Dubai) error for term "${term}":`, err)
      return []
    })
  )

  // Remote roles (GB API as proxy for global remote listings)
  const remoteResults = await runInBatches(DATA_CATEGORIES.slice(0, 12), 5, (term) =>
    fetchAdzunaTerm(term, appId, appKey, ADZUNA_BASE_GLOBAL, 'remote').catch((err) => {
      console.error(`Adzuna (remote) error for term "${term}":`, err)
      return []
    })
  )

  const allRaw = [...dubaiResults, ...remoteResults]
  const allJobs: Omit<Job, 'id' | 'scraped_at'>[] = []

  for (const r of allRaw) {
    if (seen.has(r.id)) continue
    seen.add(r.id)

    const salaryRange =
      r.salary_min && r.salary_max
        ? `AED ${Math.round(r.salary_min / 12).toLocaleString()} – ${Math.round(r.salary_max / 12).toLocaleString()} /month`
        : undefined

    const job = {
      external_id: r.id,
      source: 'adzuna' as JobSource,
      title: r.title,
      company: r.company?.display_name,
      location: r.location?.display_name || 'Dubai, UAE',
      description: r.description,
      job_url: r.redirect_url,
      salary_range: salaryRange,
      job_type: r.contract_time,
      posted_at: r.created,
      is_active: true,
    }

    if (isExcluded(job)) continue
    allJobs.push(job)
  }

  return allJobs
}
