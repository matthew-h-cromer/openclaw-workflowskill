// workflowskill_fetch_raw — HTTP fetch that preserves JSON structure.

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface FetchRawParams {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchRawResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export async function fetchRawHandler(params: FetchRawParams): Promise<FetchRawResult> {
  const { url, method = 'GET', headers = {}, body } = params;

  // Protocol validation
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 0, headers: {}, body: `Invalid URL: ${url}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { status: 0, headers: {}, body: `Unsupported protocol: ${parsed.protocol}` };
  }

  // Method validation
  const upperMethod = method.toUpperCase();
  if (!ALLOWED_METHODS.has(upperMethod)) {
    return { status: 0, headers: {}, body: `Unsupported method: ${method}` };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: upperMethod,
      headers,
      body: body !== undefined ? body : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: 0, headers: {}, body: err instanceof Error ? err.message : String(err) };
  }

  // Collect response headers
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  // Read with size guard
  let rawBody: string;
  try {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return {
        status: response.status,
        headers: responseHeaders,
        body: `Response too large: ${buffer.byteLength} bytes (max ${MAX_BYTES})`,
      };
    }
    rawBody = new TextDecoder().decode(buffer);
  } catch (err) {
    return {
      status: response.status,
      headers: responseHeaders,
      body: err instanceof Error ? err.message : String(err),
    };
  }

  // Auto-parse JSON
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return { status: response.status, headers: responseHeaders, body: JSON.parse(rawBody) as unknown };
    } catch {
      // Fall through to raw string if JSON parsing fails
    }
  }

  return { status: response.status, headers: responseHeaders, body: rawBody };
}
