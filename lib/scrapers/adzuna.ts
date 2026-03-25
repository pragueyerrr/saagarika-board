import type { Job, JobSource } from '@/types'

const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs/ae/search'

const DATA_CATEGORIES = [
  // Broad first — these get the most Adzuna UAE results
  'data analyst',
  'business analyst',
  'data scientist',
  'analytics',
  // Research & insights
  'research analyst',
  'insights analyst',
  'market research',
  // BI & reporting
  'business intelligence',
  'BI analyst',
  'reporting analyst',
  // Adjacent
  'financial analyst',
  'commercial analyst',
  'product analyst',
  'strategy analyst',
  'operations analyst',
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
  appKey: string
): Promise<AdzunaResult[]> {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: '50',
    what: term,
    'content-type': 'application/json',
  })
  const res = await fetch(`${ADZUNA_BASE}/1?${params}`, {
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

  const allRaw = await runInBatches(DATA_CATEGORIES, 5, (term) =>
    fetchAdzunaTerm(term, appId, appKey).catch((err) => {
      console.error(`Adzuna error for term "${term}":`, err)
      return []
    })
  )
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
