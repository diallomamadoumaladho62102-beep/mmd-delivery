import type {
  ProviderCreateSessionParams,
  ProviderCreateSessionResult,
  ProviderSessionSnapshot,
} from "./types";

/**
 * Provider-agnostic Identity Verification interface.
 * Stripe Identity is the first implementation; Persona/Veriff/Onfido can be added later.
 */
export interface IdentityProvider {
  readonly id: string;

  createSession(
    params: ProviderCreateSessionParams
  ): Promise<ProviderCreateSessionResult>;

  retrieveSession(sessionId: string): Promise<ProviderSessionSnapshot>;

  cancelSession?(sessionId: string): Promise<ProviderSessionSnapshot>;
}
