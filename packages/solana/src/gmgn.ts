/**
 * GMGN OpenAPI client — fetches the EXACT price + market-cap data shown on
 * gmgn.ai (same data source as the GMGN UI, so values match precisely).
 *
 * Endpoint: GET https://openapi.gmgn.ai/v1/token/info
 * Auth: X-APIKEY header + timestamp (Unix seconds) + client_id (UUID v4) query params.
 *
 * Market cap is not returned directly — computed as price × circulating_supply.
 */

import { randomUUID } from "node:crypto";

const GMGN_BASE = "https://openapi.gmgn.ai";

export interface GmgnTokenData {
  priceUsd: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
}

interface GmgnTokenInfoResponse {
  code: number;
  msg?: string;
  data?: {
    circulating_supply?: string;
    total_supply?: string;
    liquidity?: string;
    price?: { price?: string };
  };
}

export class GmgnClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchTokenInfo(mint: string, chain = "sol"): Promise<GmgnTokenData | undefined> {
    const ts = Math.floor(Date.now() / 1000);
    const url = `${GMGN_BASE}/v1/token/info?chain=${chain}&address=${mint}&timestamp=${ts}&client_id=${randomUUID()}`;

    try {
      const res = await fetch(url, {
        headers: { "X-APIKEY": this.apiKey, "Content-Type": "application/json" },
      });
      if (!res.ok) return undefined;
      const json = (await res.json()) as GmgnTokenInfoResponse;
      if (json.code !== 0 || !json.data) return undefined;

      const priceUsd = parseFloat(json.data.price?.price ?? "");
      if (!(priceUsd > 0)) return undefined;

      const supply = parseFloat(
        json.data.circulating_supply ?? json.data.total_supply ?? "",
      );
      const marketCapUsd = supply > 0 ? priceUsd * supply : undefined;
      const liquidityUsd = json.data.liquidity ? parseFloat(json.data.liquidity) : undefined;

      return { priceUsd, marketCapUsd, liquidityUsd };
    } catch {
      return undefined;
    }
  }
}
