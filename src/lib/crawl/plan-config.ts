/**
 * Per-plan crawl ceilings. Kept in sync with plans.monthly_crawl_page_limit
 * so users on higher tiers can pull bigger sites in a single crawl, not
 * just more total pages over the month.
 *
 * Each tier's per-crawl ceiling is roughly 10% of the monthly budget so
 * a starter can comfortably re-crawl ~10 times / month, pro ~10 times,
 * scale ~10 times — while giving bigger sites room to fully crawl in
 * one pass on higher tiers.
 */

export interface CrawlConfig {
  limit: number
  maxDiscoveryDepth: number
  crawlEntireDomain: boolean
}

const DEFAULT: CrawlConfig = {
  limit: 50,
  maxDiscoveryDepth: 3,
  crawlEntireDomain: false,
}

const BY_PLAN: Record<string, CrawlConfig> = {
  starter: { limit: 50, maxDiscoveryDepth: 3, crawlEntireDomain: false },
  pro: { limit: 150, maxDiscoveryDepth: 5, crawlEntireDomain: true },
  scale: { limit: 500, maxDiscoveryDepth: 8, crawlEntireDomain: true },
}

export function getCrawlConfigForPlan(planId: string | null | undefined): CrawlConfig {
  if (!planId) return DEFAULT
  return BY_PLAN[planId] ?? DEFAULT
}
