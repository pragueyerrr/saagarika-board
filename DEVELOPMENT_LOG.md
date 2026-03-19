# Dubai Creative Jobs — Development Log

Reconstructed from codebase exploration. Documents what was built, how it works, and key decisions made.

---

## Project Overview

**Goal:** Personal AI-powered job tracker for a creative professional searching for jobs in Dubai.

**App URL:** Deployed on Vercel
**Repo location:** `C:\Users\Pragya\dubai-creative-jobs`
**Tech stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS · Supabase (PostgreSQL) · Upstash Redis · Anthropic Claude API

---

## What Was Built

### 1. Database Schema (Supabase)

Three tables were created via `/supabase/migrations/001_initial.sql`:

**`jobs`** — stores scraped job listings
- `external_id + source` unique constraint for deduplication
- GIN full-text search index on `title`
- `raw_data JSONB` for source metadata
- Sources: `adzuna`, `indeed_rss`, `bayt`, `gulftalent`, `manual`

**`applications`** — tracks job applications
- Links to `jobs` via FK with CASCADE delete
- Status enum: `saved → applied → heard_back → interview_scheduled → second_interview → offer_received → rejected / withdrawn / ghosted`
- Stores AI-generated artifacts: `resume_latex`, `resume_data` (JSONB), `cover_letter_text`
- `match_score` integer (0–100) from AI scoring
- Auto-updated `updated_at` via trigger

**`cv_profiles`** — stores the user's CV (single row)
- `raw_text` — original extracted text
- `parsed_data` JSONB — structured `ParsedCV` object from Claude
- Auto-updated `updated_at` via trigger

---

### 2. Job Scrapers (`/lib/scrapers/`)

Five parallel scrapers orchestrated by `index.ts` using `Promise.allSettled()`:

| Scraper | Method | Volume | Notes |
|---------|--------|--------|-------|
| **Adzuna** (`adzuna.ts`) | REST API | 30+ creative categories, 20 results each | Batched in groups of 5; salary AED annual→monthly conversion |
| **Indeed** (`indeed.ts`) | RSS XML | 24 feed queries | `fast-xml-parser`; batched parallel fetches |
| **Bayt.com** (`bayt.ts`) | HTML scrape | 1 category page | Cheerio selectors; relative date parsing |
| **Employer Sites** (`employers.ts`) | HTML scrape | 12 major Dubai employers | Motivate, ITP, Publicis, TBWA, Leo Burnett, FP7, Ogilvy, Havas, Jumeirah, Emaar, MBC, Dubai Tourism |
| **JSearch** (`jsearch.ts`) | RapidAPI | 36 queries | Optional; aggregates multiple job boards |

**Rate limiting:** 6-hour cooldown enforced via Redis timestamp. `force: true` bypasses it.
**DB write:** Batch upsert in chunks of 100, deduplicated by `external_id + source`.

---

### 3. AI Job Scoring (`/lib/ai/scorer.ts`)

- **Model:** `claude-haiku-4-5` (cost-optimized for high-volume use)
- **Input:** Job posting (truncated to 1500 chars) + CV (truncated to 3000 chars)
- **Output:** Structured JSON scored across 5 dimensions:

| Component | Max Points |
|-----------|-----------|
| Title match | 20 |
| Skill match | 40 |
| Experience level | 20 |
| Industry match | 10 |
| Location bonus | 10 |

- Returns: `matchedSkills`, `missingSkills`, `recommendation`, `fitLevel` (excellent / good / fair / reach)
- **Caching:** 3-day TTL in Redis per job ID
- Also writes `match_score` back to `applications` table

---

### 4. Resume Generation (`/lib/ai/generator.ts`)

**Model:** `claude-opus-4-6` (full model for quality output)

**Process:**
1. Claude reads job requirements + user's full CV
2. Selects the most relevant experiences
3. Rewrites bullets to target the specific role
4. Groups skills by category
5. Writes a 2–3 line tailored summary
6. Returns `ResumeData` JSON + `fontSizePt` + `compact` flag

**Smart one-page sizing:**
- ≤3 past jobs → 11pt, normal spacing
- 4–6 jobs → 10.5pt, normal
- 7+ jobs → 9.5pt, compact mode (tighter line height, fewer bullets)

**Output formats:**
1. **LaTeX** (`/lib/latex/templates.ts`) — full `.tex` source using modernCV template; parametric spacing/font from ResumeData
2. **React PDF** (`/lib/pdf/resume-pdf.tsx`) — `@react-pdf/renderer` component, purple/dark brand theme
3. **HTML print** (`PDFDownloadButton.tsx`) — opens new window, embeds print CSS, triggers print dialog

---

### 5. Cover Letter Generation

- **Model:** `claude-opus-4-6`
- **Approach:** Streamed response via ReadableStream
- **Structure:**
  - Opening: specific enthusiasm for this company/role
  - 1–2 paragraphs: achievements mapped to job requirements
  - Closing: clear call to action
  - Max 350 words, warm professional tone, references Dubai creative scene
- **Display:** Real-time streaming text in `ResumeModal` tab
- **Export:** `CoverLetterPDFButton` — HTML print with forest green letterhead, "Re: Application for [title]" box, professional signature

---

### 6. CV Upload & Parsing (`/api/cv/upload/route.ts`)

Accepts PDF, DOCX, or TXT files:
- PDF → `pdf-parse`
- DOCX → `mammoth`
- TXT → UTF-8 decode

Extracted text → Claude → structured `ParsedCV` JSON:
```typescript
{
  summary, skills, experiences, education,
  certifications, languages, tools, softwareSkills, portfolioLinks
}
```

- Stored in `cv_profiles` table + cached in Redis (7-day TTL)
- Contact fields (`name`, `email`, `phone`, etc.) submitted separately via form

---

### 7. Application Tracker (`/app/applications/page.tsx`)

Two views toggled by the user:

**Kanban view** — columns per status, draggable-style cards
**List view** — table rows with inline status dropdowns

Per-application actions:
- Edit notes (inline)
- Update status (dropdown)
- Generate / view resume
- Delete
- View original job URL

Match score shown as a progress bar.

---

### 8. Job Browser (`/app/jobs/page.tsx`)

- Paginated (20 per page) with search (title / company / description)
- 2-column card grid on desktop
- Each `JobCard` shows: title, company, location, salary, source badge, posted time
- Score circle (animated SVG ring, color-coded by fitLevel)
- Per-card actions: Save, Score Match, Generate Resume, View Job URL
- Score breakdown panel expandable per card
- "Refresh Jobs" triggers scrape

---

### 9. Caching Strategy (`/lib/redis.ts`)

| Cache key | TTL | Contents |
|-----------|-----|----------|
| `jobs:{source}:{query}` | 24 hours | Scraped job lists |
| `job:{id}` | 48 hours | Individual job detail |
| `cv:current` | 7 days | Parsed CV data |
| `score:{jobId}` | 3 days | Job match scores |

Client-side: `sessionStorage` with 2-minute TTL for jobs, applications, CV — reduces redundant API calls.

---

### 10. API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/jobs` | Paginated job listing with optional search |
| POST | `/api/jobs/scrape` | Trigger scraping from all 5 sources |
| GET | `/api/applications` | All applications (with nested job data) |
| POST | `/api/applications` | Save a job (creates application at `saved` status) |
| PATCH | `/api/applications/[id]` | Update status, notes, score, resume, cover letter |
| DELETE | `/api/applications/[id]` | Remove application |
| GET | `/api/cv/upload` | Get current CV profile |
| POST | `/api/cv/upload` | Upload + parse CV file or pasted text |
| POST | `/api/score` | Score a job against CV (0–100) |
| POST | `/api/resume/generate` | Generate resume or cover letter for a job |

Vercel function timeouts: 60s (scraping), 120s (resume generation).

---

### 11. Key Components

| Component | Purpose |
|-----------|---------|
| `JobCard.tsx` | Job listing card with score ring + action buttons |
| `ResumeModal.tsx` | Full-screen modal: Resume / Cover Letter / LaTeX tabs |
| `ScoreDisplay.tsx` | Animated SVG score circle + breakdown bar chart |
| `PDFDownloadButton.tsx` | HTML print → PDF export for resume |
| `CoverLetterPDFButton.tsx` | HTML print → PDF export for cover letter |
| `Navigation.tsx` | Sticky top nav; active page highlighting; icon-only on mobile |

---

### 12. TypeScript Types (`/types/index.ts`)

Core types: `Job`, `Application`, `ApplicationStatus`, `CVProfile`, `ParsedCV`, `WorkExperience`, `Education`, `ResumeData`, `SkillGroup`, `ResumeExperience`, `JobScore`

Utility maps: `APPLICATION_STATUS_LABELS`, `APPLICATION_STATUS_COLORS` (Tailwind classes)

---

### 13. Environment Variables Required

```env
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ANTHROPIC_API_KEY
ADZUNA_APP_ID
ADZUNA_APP_KEY
JSEARCH_API_KEY          # optional
```

---

### 14. Key Architectural Decisions

**Parallel scraping with graceful degradation** — `Promise.allSettled()` ensures one failed source doesn't block the others. Users get partial results rather than total failure.

**Two AI model tiers** — Haiku for scoring (high-volume, cost matters), Opus for resume/cover letter generation (quality matters).

**Three resume export formats** — LaTeX for professional typesetting via Overleaf, React PDF for in-app download, HTML print as universal fallback.

**Streaming cover letters** — Real-time display via ReadableStream dramatically improves perceived responsiveness for a ~10s generation.

**Dual caching layers** — Redis (server-side, longer TTL) + sessionStorage (client-side, 2-minute TTL) reduce redundant calls at both layers.

**One-page resume enforcement** — Dynamic font sizing and compact mode flags passed in `ResumeData` let Claude control layout density, keeping resumes to a single page.

---

## Dependencies (package.json)

```
next@^15.3.1            react@^19
@anthropic-ai/sdk       @supabase/supabase-js
@upstash/redis          @react-pdf/renderer
pdf-parse               mammoth
jspdf                   html2canvas
axios                   cheerio
fast-xml-parser         lucide-react
zod                     tailwindcss
clsx                    tailwind-merge
```

---

*Documentation reconstructed from codebase on 2026-03-19.*
