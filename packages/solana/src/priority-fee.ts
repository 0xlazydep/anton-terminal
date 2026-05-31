export type PriorityLevel = "Min" | "Low" | "Medium" | "High" | "VeryHigh";

interface HeliusFeeResponse {
  result?: { priorityFeeEstimate?: number };
}

export async function getPriorityFeeEstimate(
  rpcUrl: string,
  accountKeys: string[],
  level: PriorityLevel = "High",
): Promise<number> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "anton-fee",
        method: "getPriorityFeeEstimate",
        params: [{ accountKeys, options: { priorityLevel: level } }],
      }),
    });
    const json = (await res.json()) as HeliusFeeResponse;
    return json.result?.priorityFeeEstimate ?? 50_000;
  } catch {
    return 50_000;
  }
}
