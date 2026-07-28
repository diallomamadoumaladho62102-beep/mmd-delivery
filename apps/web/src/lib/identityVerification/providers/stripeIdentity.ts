import { stripe } from "@/lib/stripe";
import type { IdentityProvider } from "../provider";
import type {
  ProviderCreateSessionParams,
  ProviderCreateSessionResult,
  ProviderSessionSnapshot,
} from "../types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readLastError(session: Record<string, unknown>): {
  code: string | null;
  reason: string | null;
} {
  const lastError = asRecord(session.last_error);
  const code =
    typeof lastError.code === "string" ? lastError.code : null;
  const reason =
    typeof lastError.reason === "string"
      ? lastError.reason
      : typeof lastError.message === "string"
        ? lastError.message
        : null;
  return { code, reason };
}

/**
 * Official Stripe Identity adapter.
 * Uses Verification Sessions + ephemeral keys (React Native / hosted redirect).
 * Documents never touch MMD servers.
 */
export class StripeIdentityProvider implements IdentityProvider {
  readonly id = "stripe_identity";

  async createSession(
    params: ProviderCreateSessionParams
  ): Promise<ProviderCreateSessionResult> {
    const flowId = String(process.env.STRIPE_IDENTITY_VERIFICATION_FLOW_ID ?? "").trim();

    const createParams: Record<string, unknown> = {
      metadata: {
        mmd_user_id: params.subjectUserId,
        mmd_subject_type: params.subjectType,
        mmd_feature_key: params.featureKey,
        ...(params.metadata ?? {}),
      },
      options: {
        document: {
          require_matching_selfie: params.requireMatchingSelfie,
          require_live_capture: params.requireLiveCapture,
          require_id_number: params.requireIdNumber,
        },
      },
    };

    if (flowId) {
      createParams.verification_flow = flowId;
    } else {
      createParams.type = params.verificationType;
    }

    if (params.email || params.phone) {
      createParams.provided_details = {
        ...(params.email ? { email: params.email } : {}),
        ...(params.phone ? { phone: params.phone } : {}),
      };
    }

    if (params.returnUrl) {
      createParams.return_url = params.returnUrl;
    }

    // Official Connect bridge: attach Identity result to Connect Person when known.
    if (params.stripeConnectAccountId && params.stripeRelatedPersonId) {
      createParams.related_person = {
        account: params.stripeConnectAccountId,
        person: params.stripeRelatedPersonId,
      };
    }

    const session = await stripe.identity.verificationSessions.create(
      createParams as never
    );

    // Ephemeral key for official React Native Identity SDK (optional client path).
    let ephemeralKeySecret: string | null = null;
    try {
      const ephemeralKey = await stripe.ephemeralKeys.create(
        { verification_session: session.id },
        // Bind to a recent Identity-capable API version for ephemeral keys.
        { apiVersion: "2024-11-20.acacia" as never }
      );
      ephemeralKeySecret = ephemeralKey.secret ?? null;
    } catch (error) {
      // Hosted URL flow still works without ephemeral keys.
      console.warn("[StripeIdentityProvider] ephemeral key create failed", error);
    }

    const raw = asRecord(session);
    return {
      sessionId: session.id,
      url: session.url ?? null,
      clientSecret: session.client_secret ?? null,
      ephemeralKeySecret,
      status: String(session.status ?? "requires_input"),
      raw,
    };
  }

  async retrieveSession(sessionId: string): Promise<ProviderSessionSnapshot> {
    const session = await stripe.identity.verificationSessions.retrieve(sessionId);
    const raw = asRecord(session);
    const { code, reason } = readLastError(raw);
    const report =
      typeof session.last_verification_report === "string"
        ? session.last_verification_report
        : asRecord(session.last_verification_report).id;

    return {
      sessionId: session.id,
      status: String(session.status ?? "requires_input"),
      lastErrorCode: code,
      lastErrorReason: reason,
      verificationReportId: typeof report === "string" ? report : null,
      url: session.url ?? null,
      clientSecret: session.client_secret ?? null,
      raw,
    };
  }

  async createEphemeralKey(sessionId: string): Promise<string | null> {
    try {
      const ephemeralKey = await stripe.ephemeralKeys.create(
        { verification_session: sessionId },
        { apiVersion: "2024-11-20.acacia" as never }
      );
      return ephemeralKey.secret ?? null;
    } catch (error) {
      console.warn("[StripeIdentityProvider] ephemeral key create failed", error);
      return null;
    }
  }

  async cancelSession(sessionId: string): Promise<ProviderSessionSnapshot> {
    const session = await stripe.identity.verificationSessions.cancel(sessionId);
    const raw = asRecord(session);
    const { code, reason } = readLastError(raw);
    return {
      sessionId: session.id,
      status: String(session.status ?? "canceled"),
      lastErrorCode: code,
      lastErrorReason: reason,
      verificationReportId: null,
      raw,
    };
  }
}

export const stripeIdentityProvider = new StripeIdentityProvider();
