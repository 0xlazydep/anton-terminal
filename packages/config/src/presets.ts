import type { ScreeningPreset } from "@anton/shared-types";

export interface ScreeningPresetConfig {
  minLpSol: number;
  lpLocked: number | null;
  top10Max: number;
  singleMax: number;
  mintFreezeRevoked: true;
}

export const screeningPresets: Record<ScreeningPreset, ScreeningPresetConfig> = {
  strict: { minLpSol: 50, lpLocked: 0.8, top10Max: 30, singleMax: 10, mintFreezeRevoked: true },
  normal: { minLpSol: 20, lpLocked: null, top10Max: 50, singleMax: 20, mintFreezeRevoked: true },
  relaxed: { minLpSol: 5, lpLocked: null, top10Max: 70, singleMax: 30, mintFreezeRevoked: true },
};

export function getScreeningPreset(name: ScreeningPreset): ScreeningPresetConfig {
  return screeningPresets[name];
}
