// workflowskill_scrape — Fetch a web page and extract data via CSS selectors.

import { load } from 'cheerio';

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ScrapeParams {
  url: string;
  selectors: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ScrapeResult {
  status: number;
  results?: Record<string, string[]>;
  error?: string;
}

export async function scrapeHandler(params: ScrapeParams): Promise<ScrapeResult> {
  const { url, selectors, headers = {} } = params;

  // Protocol validation
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 0, error: `Invalid URL: ${url}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { status: 0, error: `Unsupported protocol: ${parsed.protocol}` };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message : String(err) };
  }

  // Read with size guard
  let html: string;
  try {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return { status: response.status, error: `Response too large: ${buffer.byteLength} bytes (max ${MAX_BYTES})` };
    }
    html = new TextDecoder().decode(buffer);
  } catch (err) {
    return { status: response.status, error: err instanceof Error ? err.message : String(err) };
  }

  const $ = load(html);
  const results: Record<string, string[]> = {};

  for (const [key, selector] of Object.entries(selectors)) {
    const texts: string[] = [];
    $(selector).each((_i, el) => {
      const text = $(el).text().trim();
      if (text.length > 0) texts.push(text);
    });
    results[key] = texts;
  }

  return { status: response.status, results };
}
