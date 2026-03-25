import type { Job, JobSource } from '@/types'

const JSEARCH_BASE = 'https://jsearch.p.rapidapi.com/search'

const DATA_QUERIES_DUBAI = [
  'data analyst Dubai',
  'business analyst Dubai',
  'research analyst Dubai',
  'insights analyst Dubai',
  'market research analyst Dubai',
  'BI analyst Dubai',
  'data scientist Dubai',
  'analytics manager Dubai',
  'product analyst Dubai',
  'financial analyst Dubai',
]

const DATA_QUERIES_REMOTE = [
  'data analyst remote full time',
  'business analyst remote full time',
  'insights analyst remote full time',
  'data scientist remote full time',
  'research analyst remote full time',
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

interface JSearchJob {
  job_id: string
  job_title: string
  employer_name: string
  job_city: string
  job_country: string
  job_description: string
  job_apply_link: string
  job_employment_type: string
  job_is_remote?: boolean
  job_salary_currency?: string
  job_min_salary?: number
  job_max_salary?: number
  job_posted_at_datetime_utc?: string
}

interface JSearchResponse {
  data: JSearchJob[]
}

async function fetchJSearchQuery(query: string, apiKey: string, remote = false): Promise<JSearchJob[]> {
  const params = new URLSearchParams({
    query,
    page: '1',
    num_pages: '1',
    date_posted: 'month',
    ...(remote ? { remote_jobs_only: 'true' } : {}),
  })
  const res = await fetch(`${JSEARCH_BASE}?${params}`, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return []
  const data: JSearchResponse = await res.json()
  return data.data ?? []
}

export async function scrapeJSearch(): Promise<Omit<Job, 'id' | 'scraped_at'>[]> {
  const apiKey = process.env.JSEARCH_API_KEY
  if (!apiKey) {
    console.warn('JSEARCH_API_KEY missing — skipping JSearch')
    return []
  }

  const allJobs: Omit<Job, 'id' | 'scraped_at'>[] = []
  const seen = new Set<string>()

  // Dubai queries
  for (let i = 0; i < DATA_QUERIES_DUBAI.length; i += 5) {
    const batch = DATA_QUERIES_DUBAI.slice(i, i + 5)
    const settled = await Promise.allSettled(
      batch.map((q) =>
        fetchJSearchQuery(q, apiKey).catch((err) => {
          console.error(`JSearch error for "${q}":`, err)
          return []
        })
      )
    )
    processJSearchResults(settled, seen, allJobs, false)
  }

  // Remote queries
  for (let i = 0; i < DATA_QUERIES_REMOTE.length; i += 5) {
    const batch = DATA_QUERIES_REMOTE.slice(i, i + 5)
    const settled = await Promise.allSettled(
      batch.map((q) =>
        fetchJSearchQuery(q, apiKey, true).catch((err) => {
          console.error(`JSearch (remote) error for "${q}":`, err)
          return []
        })
      )
    )
    processJSearchResults(settled, seen, allJobs, true)
  }

  return allJobs
}

function processJSearchResults(
  settled: PromiseSettledResult<JSearchJob[]>[],
  seen: Set<string>,
  allJobs: Omit<Job, 'id' | 'scraped_at'>[],
  isRemoteBatch: boolean
) {
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const job of result.value) {
      if (seen.has(job.job_id)) continue

      // For Dubai batch: only include UAE/Dubai jobs
      if (!isRemoteBatch) {
        const country = (job.job_country ?? '').toLowerCase()
        const city = (job.job_city ?? '').toLowerCase()
        if (!country.includes('ae') && !country.includes('arab') && !city.includes('dubai')) {
          continue
        }
      } else {
        // For remote batch: only include remote or UAE
        const isRemote = job.job_is_remote || (job.job_employment_type ?? '').toLowerCase().includes('remote')
        const country = (job.job_country ?? '').toLowerCase()
        if (!isRemote && !country.includes('ae') && !country.includes('arab')) continue
      }

      const descText = job.job_description?.slice(0, 2000) ?? ''
      if (isExcluded(`${job.job_title} ${descText}`)) continue

      seen.add(job.job_id)

      let salaryRange: string | undefined
      if (job.job_min_salary && job.job_max_salary) {
        salaryRange = `${job.job_salary_currency ?? 'AED'} ${Math.round(job.job_min_salary).toLocaleString()} – ${Math.round(job.job_max_salary).toLocaleString()}`
      }

      const locationStr = isRemoteBatch
        ? 'Remote'
        : [job.job_city, job.job_country].filter(Boolean).join(', ') || 'Dubai, UAE'

      allJobs.push({
        external_id: job.job_id,
        source: 'manual' as JobSource,
        title: job.job_title,
        company: job.employer_name,
        location: locationStr,
        description: descText,
        job_url: job.job_apply_link,
        job_type: job.job_employment_type,
        salary_range: salaryRange,
        posted_at: job.job_posted_at_datetime_utc,
        is_active: true,
        raw_data: { jsearch: true },
      })
    }
  }
}
