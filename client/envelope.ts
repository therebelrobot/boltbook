/**
 * Reading a pattern envelope.
 *
 * OCR is a suggestion engine, not a parser that should be trusted: envelopes
 * are illustrated, the type is often condensed or all caps, and a stray line
 * can look like a number. Everything here is pure, so the heuristics are
 * testable without a browser or an image. The UI always shows the raw text and
 * the confidence, and nothing is saved until the person presses Save.
 */

export type EnvelopeFormat = 'envelope' | 'pdf' | 'book' | 'other'

export interface EnvelopeSuggestion {
  brand: string | null
  number: string | null
  name: string | null
  sizeMin: string | null
  sizeMax: string | null
  format: EnvelopeFormat
  category: string | null
  /** View letters found near the word "view"; deduped and sorted. */
  views: string[]
}

interface BrandMatch {
  name: string
  pattern: RegExp
}

/**
 * The big houses first, then the independent pattern companies. These are
 * suggestions, not a closed vocabulary; a missing brand just leaves the field
 * empty for the person to type.
 */
const BRANDS: BrandMatch[] = [
  { name: "McCall's", pattern: /\bmc\s*call['’]?s?\b/i },
  { name: 'Butterick', pattern: /\bbutterick\b/i },
  { name: 'Simplicity', pattern: /\bsimplicity\b/i },
  { name: 'Vogue', pattern: /\bvogue\b/i },
  { name: 'Burda', pattern: /\bburda\s*(?:style)?\b/i },
  { name: 'Kwik Sew', pattern: /\bkwik\s*sew\b/i },
  { name: 'New Look', pattern: /\bnew\s*look\b/i },
  { name: 'Grainline Studio', pattern: /\bgrainline\b/i },
  { name: 'Closet Core Patterns', pattern: /\bcloset\s*core\b/i },
  { name: 'Sew Liberated', pattern: /\bsew\s*liberated\b/i },
  { name: 'Deer & Doe', pattern: /\bdeer\s*(?:&|and)\s*doe\b/i },
  { name: 'Merchant & Mills', pattern: /\bmerchant\s*(?:&|and)\s*mills\b/i },
  { name: 'Named Clothing', pattern: /\bnamed\b/i },
  { name: 'Papercut Patterns', pattern: /\bpapercut\b/i },
  { name: 'True Bias', pattern: /\btrue\s*bias\b/i },
  { name: 'Friday Pattern Company', pattern: /\bfriday\s*pattern\b/i },
  { name: "Helen's Closet", pattern: /\bhelen['’]?s\s*closet\b/i },
  { name: 'Seamwork', pattern: /\bseamwork\b/i },
  { name: 'Cashmerette', pattern: /\bcashmerette\b/i },
  { name: 'Tilly and the Buttons', pattern: /\btilly\s*(?:and|&|\+)?\s*the\s*buttons\b/i },
  { name: 'Colette', pattern: /\bcolette\b/i },
  { name: 'Megan Nielsen', pattern: /\bmegan\s*nielsen\b/i },
  { name: 'Fibre Mood', pattern: /\bfibre\s*mood\b/i },
  { name: 'The Assembly Line', pattern: /\bthe\s*assembly\s*line\b/i },
  { name: 'Sew House Seven', pattern: /\bsew\s*house\s*seven\b/i },
  { name: 'Liesl + Co', pattern: /\bliesl\s*\+?\s*co\b/i },
  { name: 'Oliver + S', pattern: /\boliver\s*\+\s*s\b/i },
  { name: 'Jalie', pattern: /\bjalie\b/i },
  { name: 'By Hand London', pattern: /\bby\s*hand\s*lon?don\b/i },
  { name: 'Pauline Alice', pattern: /\bpauline\s*alice\b/i },
  { name: 'Sew Over It', pattern: /\bsew\s*over\s*it\b/i },
  { name: 'Wardrobe By Me', pattern: /\bwardrobe\s*by\s*me\b/i },
  { name: 'Love Notions', pattern: /\blove\s*notions\b/i },
  { name: 'Made for Mermaids', pattern: /\bmade\s*for\s*mermaids\b/i },
  { name: 'Charm Patterns', pattern: /\bcharm\s*patterns\b/i },
  { name: 'Gertie', pattern: /\bgertie\b/i },
]

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(?:dress|gown)\b/i, category: 'dress' },
  { pattern: /\b(?:shirt|button[- ]?up|blouse)\b/i, category: 'shirt' },
  { pattern: /\b(?:top|t-shirt|tee|tank|camisole)\b/i, category: 'top' },
  { pattern: /\b(?:jeans?|trousers?|pants?|bottoms?)\b/i, category: 'bottoms' },
  { pattern: /\b(?:skirt)\b/i, category: 'skirt' },
  { pattern: /\b(?:shorts?)\b/i, category: 'shorts' },
  { pattern: /\b(?:coat|jacket|blazer|parka|outerwear)\b/i, category: 'outerwear' },
  { pattern: /\b(?:cardigan|sweater|jumper|knitwear)\b/i, category: 'knitwear' },
  { pattern: /\b(?:bag|tote|purse|backpack)\b/i, category: 'bag' },
  { pattern: /\b(?:hat|cap|beanie)\b/i, category: 'hat' },
  { pattern: /\b(?:swim|bikini|swimsuit)\b/i, category: 'swim' },
  { pattern: /\b(?:lingerie|bra|underwear|panties)\b/i, category: 'lingerie' },
  { pattern: /\b(?:jumpsuit|romper|overalls?)\b/i, category: 'jumpsuit' },
  { pattern: /\b(?:baby|kids?|children|toddler)\b/i, category: 'kids' },
]

/** A line that cannot be the pattern's name. */
const NAME_EXCLUDE =
  /\b(?:size|sizes|bust|waist|hip|view|views|notions|fabric|yardage|instructions|pattern|patterns|sewing|difficulty|easy|intermediate|advanced|beginner|skill|level|pdf|envelope|paper|book|includes?|printed|mccall|butterick|vogue|simplicity|burda|grainline|studio|closet|core|liberated|named|papercut|bias|friday|helen|seamwork|cashmerette|tilly|colette|megan|fibre|assembly|house|liesl|oliver|jalie|pauline|wardrobe|love|mermaids|charm|gertie)\b/i

function cleanLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
}

function findBrand(text: string): BrandMatch | null {
  for (const brand of BRANDS) if (brand.pattern.test(text)) return brand
  return null
}

function findNumber(text: string): string | null {
  // Pattern numbers often carry a house prefix: McCall's M7969, Butterick
  // B6842, Simplicity S9123, Vogue V1234.
  const explicit = text.match(/\b(?:no\.?|number|#)\s*([A-Z]?[0-9]{3,5})\b/i)
  if (explicit) return explicit[1] ?? null

  // With no "No." / "#", a 4–5 digit number is only plausible when it is not a
  // size chart or a year. Short numbers are too often sizes to guess.
  for (const line of text.split('\n')) {
    if (/\b(?:sizes?|bust|waist|hip|year)\b/i.test(line)) continue
    const match = line.match(/\b([A-Z]?[0-9]{4,5}|[A-Z][0-9]{3})\b/i)
    const value = match?.[1]
    if (value && !/^(?:19|20)\d{2}$/.test(value)) return value
  }
  return null
}

function normalizeSize(value: string): string {
  return /^[0-9]+$/.test(value) ? value : value.toUpperCase()
}

function findSizes(text: string): { min: string; max: string } | null {
  const match = text.match(
    /\b(?:sizes?|misses|women|petite)\b[^0-9A-Z]{0,16}([0-9]{1,2}|[A-Z]{1,3})\s*(?:-|–|—|to|thru|through)\s*([0-9]{1,2}|[A-Z]{1,3})\b/i,
  )
  if (!match?.[1] || !match[2]) return null
  return { min: normalizeSize(match[1]), max: normalizeSize(match[2]) }
}

function findViews(lines: readonly string[]): string[] {
  const found = new Set<string>()
  for (const line of lines) {
    // OCR often drops the space in "VIEW A/B" and reads "VIEWA/B", so the
    // separator is optional rather than a required word boundary.
    const marker = line.match(/\bviews?[\s:.-]*/i)
    if (!marker) continue
    const afterView = line.slice((marker.index ?? 0) + marker[0].length)
    for (const match of afterView.matchAll(/\b([A-F])\b/gi)) found.add(match[1]!.toUpperCase())
  }
  return [...found].sort()
}

function findFormat(text: string): EnvelopeFormat {
  if (/\bpdf\b/i.test(text)) return 'pdf'
  if (/\bbook\b/i.test(text)) return 'book'
  // The scan is of an envelope; the format is the context, not a guess.
  return 'envelope'
}

function scoreName(line: string): number {
  const words = line.split(/\s+/)
  let score = 0
  if (words.length >= 2 && words.length <= 5) score += 2
  if (/^[A-Z]/.test(line)) score += 1
  if (/-|&|\+/.test(line)) score += 1
  if (words.some((word) => /^[A-Z][a-z]+$/.test(word))) score += 1
  if (words.every((word) => word === word.toUpperCase())) score -= 1
  if (line.length > 50) score -= 2
  return score
}

function findName(lines: readonly string[], brand: BrandMatch | null): string | null {
  const candidates: Array<{ line: string; score: number }> = []
  for (const line of lines) {
    let cleaned = brand ? line.replace(brand.pattern, ' ') : line
    cleaned = cleaned
      .replace(/\s+/g, ' ')
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
      .trim()
    if (!cleaned) continue
    const words = cleaned.split(/\s+/)
    if (words.length < 2 || words.length > 5) continue
    if (/\d/.test(cleaned)) continue
    if (NAME_EXCLUDE.test(cleaned)) continue
    if (!/[A-Za-z]{2}/.test(cleaned)) continue
    candidates.push({ line: cleaned, score: scoreName(cleaned) })
  }
  candidates.sort((a, b) => b.score - a.score || a.line.length - b.line.length)
  const best = candidates[0]
  return best && best.score >= 2 ? best.line : null
}

function findCategory(text: string): string | null {
  for (const { pattern, category } of CATEGORY_PATTERNS) if (pattern.test(text)) return category
  return null
}

export function parseEnvelope(text: string): EnvelopeSuggestion {
  const lines = cleanLines(text)
  const brand = findBrand(text)
  const sizes = findSizes(text)
  return {
    brand: brand?.name ?? null,
    number: findNumber(text),
    name: findName(lines, brand),
    sizeMin: sizes?.min ?? null,
    sizeMax: sizes?.max ?? null,
    format: findFormat(text),
    category: findCategory(text),
    views: findViews(lines),
  }
}
