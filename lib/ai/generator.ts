import Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL } from './claude'
import type { Job, CVProfile, ResumeData, ParsedCV } from '@/types'

// ─── Resume JSON Generation ─────────────────────────────────────────────────

export async function generateResumeData(
  job: Job,
  cv: CVProfile
): Promise<ResumeData> {
  const cvData = cv.parsed_data as ParsedCV | undefined
  const cvText = cv.raw_text ?? JSON.stringify(cvData ?? {})

  const systemPrompt = `You are an expert resume writer specializing in data analysis, business intelligence, market research, and insights roles in Dubai and remote (data analyst, business analyst, research analyst, insights analyst, BI analyst, data scientist, product analyst, strategy analyst).

Your goal: craft a HIGHLY TAILORED, one-page resume for this candidate applying to this specific job.

RULES:
1. The resume MUST fit on one page — adjust bullet count, font size hint, and compact flag accordingly
2. Prioritize skills/experiences most relevant to THIS specific job
3. Summary must be 2-3 lines max, directly addressing the role
4. Skills must be grouped by category, most relevant first (e.g. Data Analysis & Statistics, Tools & Platforms, Business Intelligence, Research & Insights)
5. Each job should have 2-4 bullets maximum (compact: 2, normal: 3-4)
6. Use strong action verbs, quantify where possible (e.g. "Reduced reporting time by X%", "Analysed dataset of Xk records", "Built dashboard tracking X KPIs", "Delivered insights that drove X% revenue uplift")
7. Return ONLY valid JSON — no markdown fences, no explanation`

  const userPrompt = `JOB POSTING:
Title: ${job.title}
Company: ${job.company ?? 'N/A'}
Location: ${job.location ?? 'Dubai, UAE'}
Description: ${job.description ?? ''}
Requirements: ${job.requirements ?? ''}

---
CANDIDATE CV / RAW TEXT:
${cvText}

---
Candidate contact info:
Name: ${cv.name ?? '[Full Name]'}
Email: ${cv.email ?? '[email]'}
Phone: ${cv.phone ?? ''}
Location: ${cv.location ?? 'Dubai, UAE'}
Website: ${cv.website ?? ''}
LinkedIn: ${cv.linkedin ?? ''}
Portfolio: ${cv.portfolio ?? ''}

---
Return this exact JSON structure:
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "+971 XX XXX XXXX",
  "location": "Dubai, UAE",
  "website": "portfolio.com",
  "linkedin": "linkedin.com/in/handle",
  "portfolio": "portfolio.com",
  "summary": "2-3 sentence professional summary tailored to this role",
  "skills": [
    { "category": "Data Analysis & Statistics", "items": ["Python", "R", "SQL", "Statistical Modelling"] },
    { "category": "Business Intelligence", "items": ["Tableau", "Power BI", "Looker", "Google Data Studio"] },
    { "category": "Tools & Platforms", "items": ["Excel", "Google Sheets", "Jupyter", "dbt"] },
    { "category": "Research & Insights", "items": ["Survey Design", "Market Research", "A/B Testing", "User Research"] }
  ],
  "experiences": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "location": "Dubai, UAE",
      "period": "Jan 2022 – Present",
      "bullets": [
        "Built automated dashboard tracking 12 KPIs, reducing weekly reporting time by 60%",
        "Analysed customer dataset of 200k records to surface segmentation insights that drove 18% revenue uplift"
      ],
      "relevanceScore": 90
    }
  ],
  "education": [
    {
      "degree": "BA Graphic Design",
      "institution": "University Name",
      "location": "City, Country",
      "year": "2018"
    }
  ],
  "certifications": ["Google Data Analytics Certificate", "Tableau Desktop Specialist"],
  "fontSizePt": 10,
  "compact": false
}

Choose fontSizePt (9.5, 10, 10.5, or 11) and compact (true/false) to ensure content fits on ONE PAGE.
If there's lots of experience: use 9.5pt + compact:true.
If experience is lean: use 11pt + compact:false.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [
      { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` },
    ],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude for resume generation')
  }

  const cleaned = textBlock.text.replace(/```[a-z]*\n?/g, '').trim()
  return JSON.parse(cleaned) as ResumeData
}

// ─── Cover Letter Generation (streaming) ────────────────────────────────────

export async function generateCoverLetterStream(
  job: Job,
  cv: CVProfile
): Promise<ReturnType<typeof anthropic.messages.stream>> {
  const cvText = cv.raw_text ?? JSON.stringify(cv.parsed_data ?? {})

  return anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `You are an expert cover letter writer for data analysis and insights professionals in Dubai and remote roles.

Write a compelling, personalized cover letter for this candidate applying to this job.

CANDIDATE:
Name: ${cv.name ?? 'The Candidate'}
Background: ${cvText}

JOB:
Title: ${job.title}
Company: ${job.company ?? 'the company'}
Location: ${job.location ?? 'Dubai, UAE'}
Description: ${job.description ?? ''}
Requirements: ${job.requirements ?? ''}

GUIDELINES:
- 3-4 paragraphs, professional yet warm tone appropriate for data and research roles
- Opening: Hook with specific enthusiasm for THIS company — reference their data-driven approach, products, or industry position
- Middle 1-2 paragraphs: Connect 2-3 specific data/research achievements to the job requirements (datasets analysed, dashboards built, insights that drove business decisions)
- Closing: Clear call to action
- Max 350 words
- Do NOT use generic phrases like "I am writing to express my interest"
- Reference Dubai's growing data and tech ecosystem or global remote culture where relevant
- Format: Just the letter body (no date, no address headers needed)
- End with exactly ONE sign-off (e.g. "Warm regards, [Name]") — do NOT include two closings`,
      },
    ],
  })
}

// ─── CV Parsing with Claude ──────────────────────────────────────────────────

export async function parseCVWithClaude(rawText: string): Promise<ParsedCV> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `Extract structured data from this CV/resume text. Return ONLY valid JSON, no markdown.

CV TEXT:
${rawText}

Return this exact structure:
{
  "summary": "brief professional summary if present",
  "skills": ["skill1", "skill2"],
  "experiences": [
    {
      "title": "Job Title",
      "company": "Company",
      "location": "City",
      "startDate": "2020",
      "endDate": "2022",
      "current": false,
      "bullets": ["Achievement 1", "Achievement 2"]
    }
  ],
  "education": [
    {
      "degree": "BA Design",
      "institution": "University",
      "location": "City",
      "year": "2018"
    }
  ],
  "certifications": [],
  "languages": [],
  "tools": [],
  "softwareSkills": [],
  "portfolioLinks": []
}`,
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Failed to parse CV with Claude')
  }

  const cleaned = textBlock.text.replace(/```[a-z]*\n?/g, '').trim()
  return JSON.parse(cleaned) as ParsedCV
}
