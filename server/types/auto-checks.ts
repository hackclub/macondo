import type { PlayableUrlVerdict } from "./url-validation";

export type AutoCheckStatus = "ok" | "missing" | "thin" | "skipped";

export interface AutoCheckSoftware {
  readme: AutoCheckStatus;
  run_instructions: AutoCheckStatus;
  notes: string[];
}

export interface AutoCheckHardware {
  cart: AutoCheckStatus;
  bom: AutoCheckStatus;
  build_photos: AutoCheckStatus;
  notes: string[];
}

// Never hard-blocks a submission; only surfaces to reviewers and as pre-submit nudges.
export type AutoCheckVerdict = "ok" | "warn" | "flag" | "skipped";

export interface AutoCheckDescription {
  status: AutoCheckVerdict;
  reason?: string;
}

export interface AutoCheckIdentity {
  name: AutoCheckVerdict;
  address: AutoCheckVerdict;
  address_needed: boolean;
  notes: string[];
}

export interface AutoCheckResult {
  software?: AutoCheckSoftware;
  hardware?: AutoCheckHardware;
  description?: AutoCheckDescription;
  identity?: AutoCheckIdentity;
  playable_url?: PlayableUrlVerdict | null;
  generated_at: string;
}
