// Shared import pipeline — ported verbatim from adtrack-hub.
// Handles: header detection, column mapping, ad matching, commit.

export type Source = "meta" | "shopify" | "payment";

export const FIELDS: Record<Source, { key: string; label: string; synonyms: string[]; required?: boolean }[]> = {
  meta: [
    { key: "date", label: "Date", synonyms: ["date", "day", "reporting starts", "date_start"], required: true },
    { key: "ad_name", label: "Ad name", synonyms: ["ad name", "ad", "ad_name"], required: true },
    { key: "campaign_name", label: "Campaign", synonyms: ["campaign name", "campaign", "campaign_name"] },
    { key: "spend", label: "Spend", synonyms: ["amount spent", "spend", "cost", "spend (usd)"] },
    { key: "results", label: "Results", synonyms: ["results", "conversions"] },
    { key: "reach", label: "Reach", synonyms: ["reach"] },
    { key: "impressions", label: "Impressions", synonyms: ["impressions", "impr."] },
    { key: "clicks", label: "Clicks", synonyms: ["clicks", "clicks (all)", "link clicks"] },
    { key: "landing_page_views", label: "LP Views", synonyms: ["landing page views", "landing_page_view"] },
    { key: "add_to_cart", label: "Add to cart", synonyms: ["adds to cart", "add to cart", "atc"] },
    { key: "purchases", label: "Purchases", synonyms: ["purchases", "website purchases"] },
    { key: "frequency", label: "Frequency", synonyms: ["frequency", "freq"] },
  ],
  shopify: [
    { key: "date", label: "Date", synonyms: ["date", "day"], required: true },
    { key: "ad_name", label: "Ad name (optional)", synonyms: ["ad name", "ad", "utm_content"] },
    { key: "campaign_name", label: "Campaign", synonyms: ["campaign", "utm_campaign"] },
    { key: "sessions", label: "Sessions", synonyms: ["sessions", "visits"] },
    { key: "orders", label: "Orders", synonyms: ["orders", "total orders"] },
    { key: "order_value", label: "Order value", synonyms: ["total sales", "order value", "revenue", "sales"] },
  ],
  payment: [
    { key: "date", label: "Date", synonyms: ["date", "day"], required: true },
    { key: "ad_name", label: "Ad name (optional)", synonyms: ["ad name", "ad"] },
    { key: "campaign_name", label: "Campaign", synonyms: ["campaign"] },
    { key: "gross_amount", label: "Gross amount", synonyms: ["gross", "amount", "gross_amount", "total"] },
    { key: "transactions", label: "Transactions", synonyms: ["transactions", "txn", "count"] },
    { key: "fees", label: "Fees", synonyms: ["fees", "fee"] },
  ],
};

const norm = (s: string) => s.toLowerCase().trim().replace(/[_\-\s]+/g, " ");

export function autoDetectMapping(source: Source, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const fields = FIELDS[source];
  const normHeaders = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const f of fields) {
    const found = normHeaders.find((h) => f.synonyms.some((s) => norm(s) === h.n));
    if (found) map[f.key] = found.raw;
  }
  return map;
}

export type ParsedRow = Record<string, string | number>;

export function applyMapping(source: Source, rows: ParsedRow[], mapping: Record<string, string>): ParsedRow[] {
  return rows.map((r) => {
    const out: ParsedRow = {};
    for (const [field, header] of Object.entries(mapping)) {
      if (!header) continue;
      out[field] = r[header];
    }
    return out;
  });
}

export function normalizeDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[,$\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

export type Resolution = {
  ad_name: string;
  campaign_name?: string;
  action: "link" | "create" | "skip" | "unattributed";
  ad_id?: string | null;
};

export type ExistingAd = { id: string; name: string; campaign_id: string; campaign_name: string };

export function buildResolutions(
  rows: ParsedRow[],
  existingAds: ExistingAd[],
  allowUnattributed: boolean,
): Resolution[] {
  const seen = new Map<string, Resolution>();
  for (const r of rows) {
    const adName = r.ad_name ? String(r.ad_name).trim() : "";
    const campaignName = r.campaign_name ? String(r.campaign_name).trim() : "";
    const key = adName || (allowUnattributed ? "__unattributed__" : "");
    if (!key || seen.has(key)) continue;
    if (!adName && allowUnattributed) {
      seen.set(key, { ad_name: "", action: "unattributed" });
      continue;
    }
    const match = existingAds.find((a) => a.name.toLowerCase() === adName.toLowerCase());
    if (match) {
      seen.set(key, { ad_name: adName, campaign_name: match.campaign_name, action: "link", ad_id: match.id });
    } else {
      seen.set(key, { ad_name: adName, campaign_name: campaignName || "Uncategorized", action: "create" });
    }
  }
  return Array.from(seen.values());
}

export async function commitResolutions(
  accountId: string,
  resolutions: Resolution[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const { data: existingCamps } = await supabase
    .from("signal_campaigns")
    .select("id,name")
    .eq("account_id", accountId);
  const campByName = new Map((existingCamps ?? []).map((c) => [c.name.toLowerCase(), c.id]));

  for (const r of resolutions) {
    if (r.action === "skip") { result.set(r.ad_name, null); continue; }
    if (r.action === "unattributed") { result.set("", null); continue; }
    if (r.action === "link" && r.ad_id) { result.set(r.ad_name, r.ad_id); continue; }
    const campName = r.campaign_name || "Uncategorized";
    let campId = campByName.get(campName.toLowerCase());
    if (!campId) {
      const { data: c, error } = await supabase
        .from("signal_campaigns")
        .insert({ account_id: accountId, name: campName })
        .select("id")
        .single();
      if (error) throw error;
      campId = c.id;
      campByName.set(campName.toLowerCase(), campId);
    }
    const { data: ad, error: aerr } = await supabase
      .from("signal_ads")
      .insert({ account_id: accountId, campaign_id: campId!, name: r.ad_name })
      .select("id")
      .single();
    if (aerr) throw aerr;
    result.set(r.ad_name, ad.id);
  }
  return result;
}

// Need supabase for commitResolutions and upsertMetrics
import { supabase } from "./supabase";

export async function upsertMetrics(
  source: Source,
  accountId: string,
  rows: ParsedRow[],
  adIdByName: Map<string, string | null>,
) {
  const records: any[] = [];
  for (const r of rows) {
    const date = normalizeDate(r.date);
    if (!date) continue;
    const adName = r.ad_name ? String(r.ad_name).trim() : "";
    const adId = adIdByName.has(adName) ? adIdByName.get(adName) : adIdByName.get("");
    if (source === "meta") {
      if (!adId) continue;
      records.push({
        account_id: accountId,
        ad_id: adId,
        date,
        spend: toNum(r.spend),
        results: toNum(r.results),
        reach: toNum(r.reach),
        impressions: toNum(r.impressions),
        clicks: toNum(r.clicks),
        landing_page_views: toNum(r.landing_page_views),
        add_to_cart: toNum(r.add_to_cart),
        purchases: toNum(r.purchases),
        frequency: toNum(r.frequency),
      });
    } else if (source === "shopify") {
      records.push({
        account_id: accountId,
        ad_id: adId ?? null,
        date,
        sessions: toNum(r.sessions),
        orders: toNum(r.orders),
        order_value: toNum(r.order_value),
      });
    } else {
      records.push({
        account_id: accountId,
        ad_id: adId ?? null,
        date,
        gross_amount: toNum(r.gross_amount),
        transactions: toNum(r.transactions),
        fees: toNum(r.fees),
      });
    }
  }
  if (!records.length) return { count: 0 };
  if (source === "meta") {
    const { error } = await supabase.from("signal_meta_metrics").upsert(records, { onConflict: "ad_id,date" });
    if (error) throw error;
  } else if (source === "shopify") {
    for (const rec of records) {
      const q = supabase.from("signal_shopify_metrics").delete().eq("account_id", rec.account_id).eq("date", rec.date);
      if (rec.ad_id === null) await q.is("ad_id", null);
      else await q.eq("ad_id", rec.ad_id);
    }
    const { error } = await supabase.from("signal_shopify_metrics").insert(records);
    if (error) throw error;
  } else {
    for (const rec of records) {
      const q = supabase.from("signal_payment_metrics").delete().eq("account_id", rec.account_id).eq("date", rec.date);
      if (rec.ad_id === null) await q.is("ad_id", null);
      else await q.eq("ad_id", rec.ad_id);
    }
    const { error } = await supabase.from("signal_payment_metrics").insert(records);
    if (error) throw error;
  }
  return { count: records.length };
}
