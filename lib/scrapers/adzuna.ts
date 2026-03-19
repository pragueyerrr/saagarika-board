import type { Job, JobSource } from '@/types'

const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs/ae/search'

const CREATIVE_CATEGORIES = [
  // Core social media
  'social media manager',
  'social media strategist',
  'social media coordinator',
  'social media assistant',
  'social media specialist',
  'head of social media',
  // Performance marketing
  'performance marketing manager',
  'performance marketing specialist',
  'paid social manager',
  'paid media manager',
  'PPC manager',
  // Digital marketing
  'digital marketing manager',
  'digital marketing specialist',
  'digital marketing coordinator',
  'growth marketing manager',
  // Content marketing
  'content marketing manager',
  'content strategist',
  'content manager',
  // Brand & strategy
  'brand manager',
  'marketing manager',
  'marketing coordinator',
  'marketing assistant',
  'marketing strategist',
  // Reach roles (masters-level)
  'head of digital marketing',
  'head of marketing',
  'marketing director',
  'CRM manager',
  'email marketing manager',
  'media planner',
  'e-commerce marketing manager',
]

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
    results_per_page: '20',
    what: term,
    where: 'dubai',
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

export async function scrapeAdzuna(
  searchTerms: string[] = CREATIVE_CATEGORIES // PM_CATEGORIES
): Promise<Omit<Job, 'id' | 'scraped_at'>[]> {
  const appId = process.env.ADZUNA_APP_ID
  const appKey = process.env.ADZUNA_APP_KEY

  if (!appId || !appKey) {
    console.warn('Adzuna credentials missing — skipping Adzuna scrape')
    return []
  }

  const seen = new Set<string>()
  const rawResults = await runInBatches(searchTerms, 5, (term) =>
    fetchAdzunaTerm(term, appId, appKey).catch((err) => {
      console.error(`Adzuna error for term "${term}":`, err)
      return []
    })
  )

  const allJobs: Omit<Job, 'id' | 'scraped_at'>[] = []
  for (const r of rawResults) {
    if (seen.has(r.id)) continue
    seen.add(r.id)

    const salaryRange =
      r.salary_min && r.salary_max
        ? `AED ${Math.round(r.salary_min / 12).toLocaleString()} – ${Math.round(r.salary_max / 12).toLocaleString()} /month`
        : undefined

    allJobs.push({
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
    })
  }

  return allJobs
}
