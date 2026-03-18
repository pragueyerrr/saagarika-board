'use client'

import { Download } from 'lucide-react'
import type { ResumeData } from '@/types'

interface Props {
  data: ResumeData
  jobTitle: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildResumeHTML(data: ResumeData): string {
  const maxBullets = data.compact ? 2 : 4
  const fs = data.fontSizePt
  const gap = data.compact ? '5pt' : '7pt'

  const sortedExp = [...data.experiences].sort(
    (a, b) => b.relevanceScore - a.relevanceScore
  )

  const contactParts = [
    data.phone,
    data.email,
    data.location,
    data.linkedin ? data.linkedin.replace(/^https?:\/\//, '') : null,
    (data.portfolio || data.website)
      ? (data.portfolio || data.website)!.replace(/^https?:\/\//, '')
      : null,
  ]
    .filter(Boolean)
    .map((s) => escapeHtml(s as string))
    .join(' &thinsp;·&thinsp; ')

  const skillsHTML = data.skills
    .map(
      (g) =>
        `<div class="skill-row"><strong>${escapeHtml(g.category)}:</strong> ${g.items.map(escapeHtml).join(', ')}</div>`
    )
    .join('')

  const expHTML = sortedExp
    .map(
      (exp) => `
    <div class="exp-item">
      <div class="exp-header">
        <span class="exp-title">${escapeHtml(exp.title)}</span>
        <span class="exp-date">${escapeHtml(exp.period)}</span>
      </div>
      <div class="exp-company">${escapeHtml(exp.company)}${exp.location ? ` &mdash; ${escapeHtml(exp.location)}` : ''}</div>
      <ul>${exp.bullets.slice(0, maxBullets).map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
    </div>`
    )
    .join('')

  const eduHTML = data.education
    .map(
      (e) => `
    <div class="edu-item">
      <div class="edu-row"><strong>${escapeHtml(e.degree)}</strong>${e.year ? `<span class="muted">${escapeHtml(e.year)}</span>` : ''}</div>
      <div class="muted-sm">${escapeHtml(e.institution)}${e.location ? `, ${escapeHtml(e.location)}` : ''}</div>
    </div>`
    )
    .join('')

  const certsHTML = data.certifications?.length
    ? `<div class="section">
        <div class="sec-title">Certifications</div>
        <div class="muted-sm">${data.certifications.map(escapeHtml).join(' &thinsp;·&thinsp; ')}</div>
       </div>`
    : ''

  const padV = data.compact ? '0.55in' : '0.65in'
  const padH = data.compact ? '0.6in' : '0.7in'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(data.name)} — Resume</title>
<style>
  /* Zero @page margin hides browser print headers/footers */
  @page { size: A4 portrait; margin: 0; }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: white; }

  .page {
    width: 21cm;
    min-height: 29.7cm;
    padding: ${padV} ${padH};
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: ${fs}pt;
    color: #111;
    line-height: 1.35;
    background: white;
  }
  a { color: #111; text-decoration: none; }

  .header { text-align: center; margin-bottom: 10pt; }
  .name { font-size: ${fs + 8}pt; font-weight: 700; margin-bottom: 3pt; }
  .contact { font-size: ${fs - 1}pt; color: #555; }

  .section { margin-top: ${gap}; }
  .sec-title {
    font-size: ${fs + 0.5}pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4pt;
    color: #6d28d9;
    border-bottom: 0.75pt solid #6d28d9;
    padding-bottom: 1.5pt;
    margin-bottom: ${data.compact ? '3pt' : '5pt'};
  }
  .summary { font-size: ${fs - 0.5}pt; color: #374151; line-height: 1.5; }
  .skill-row { font-size: ${fs - 1}pt; color: #374151; margin-bottom: ${data.compact ? '1.5pt' : '2.5pt'}; }
  .exp-item { margin-top: ${data.compact ? '4pt' : '6pt'}; }
  .exp-header { display: flex; justify-content: space-between; align-items: baseline; }
  .exp-title { font-weight: 700; font-size: ${fs}pt; }
  .exp-date { font-size: ${fs - 1}pt; color: #888; }
  .exp-company { font-style: italic; font-size: ${fs - 0.5}pt; color: #555; margin-bottom: 2pt; }
  ul { padding-left: 12pt; }
  li { font-size: ${fs - 1}pt; color: #374151; margin-bottom: ${data.compact ? '0.5pt' : '1pt'}; line-height: 1.4; }
  .edu-item { margin-bottom: 3pt; }
  .edu-row { display: flex; justify-content: space-between; font-size: ${fs - 0.5}pt; }
  .muted { font-size: ${fs - 1}pt; color: #888; }
  .muted-sm { font-size: ${fs - 1}pt; color: #555; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="name">${escapeHtml(data.name)}</div>
    <div class="contact">${contactParts}</div>
  </div>

  <div class="section">
    <div class="sec-title">Professional Summary</div>
    <div class="summary">${escapeHtml(data.summary)}</div>
  </div>

  <div class="section">
    <div class="sec-title">Skills</div>
    ${skillsHTML}
  </div>

  <div class="section">
    <div class="sec-title">Experience</div>
    ${expHTML}
  </div>

  <div class="section">
    <div class="sec-title">Education</div>
    ${eduHTML}
  </div>

  ${certsHTML}
</div>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 250))</script>
</body>
</html>`
}

export default function PDFDownloadButton({ data, jobTitle }: Props) {
  const handleDownload = () => {
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) {
      alert('Please allow popups for this site.')
      return
    }
    win.document.write(buildResumeHTML(data))
    win.document.close()
  }

  return (
    <button onClick={handleDownload} className="btn-primary text-xs py-1.5">
      <Download className="w-3 h-3" />
      Download PDF
    </button>
  )
}
