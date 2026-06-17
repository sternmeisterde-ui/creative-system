// Клиент Google Ads API: refresh_token → access_token (с кешем) + GAQL-поиск.
// Доступ через MCC (login-customer-id), данные тянем из GOOGLE_ADS_CUSTOMER_ID.
const DEV_TOKEN     = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const CLIENT_ID     = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const LOGIN_CID     = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
const CUSTOMER_ID   = process.env.GOOGLE_ADS_CUSTOMER_ID;
const API_VERSION   = process.env.GOOGLE_ADS_API_VERSION ?? "v21";

export const GOOGLE_CUSTOMER_ID = CUSTOMER_ID;

// access_token живёт ~1ч — кешируем в памяти процесса.
let cached: { token: string; exp: number } | null = null;

export async function getGoogleAccessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error(`Google OAuth: ${JSON.stringify(data).slice(0, 200)}`);
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

// Выполняет GAQL-запрос (с пагинацией) и возвращает все строки результата.
export async function googleAdsSearch(query: string, customerId = CUSTOMER_ID): Promise<Record<string, unknown>[]> {
  const token = await getGoogleAccessToken();
  const all: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "developer-token": DEV_TOKEN!,
          "login-customer-id": LOGIN_CID!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
      }
    );
    const data = await res.json() as { results?: Record<string, unknown>[]; nextPageToken?: string; error?: unknown };
    if (data.error) throw new Error(`Google Ads API: ${JSON.stringify(data.error).slice(0, 300)}`);
    all.push(...(data.results ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}
