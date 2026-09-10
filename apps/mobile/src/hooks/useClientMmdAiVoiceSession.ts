import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { postAiChat, type AiChatHistoryTurn } from "../lib/mmdAiApi";
import {
  cancelMmdAiRecording,
  listenUntilSilence,
  requestStopMmdAiListen,
  transcribeMmdAiAudio,
} from "../lib/mmdAiSpeech";
import { speakMmdAiReply, stopMmdAiSpeech } from "../lib/mmdAiVoice";
import { resolveAiVoiceLanguages } from "../lib/mmdAiVoiceLanguages";
import {
  isVoiceSessionActive,
  voiceFabTapAction,
  type MmdAiVoicePhase,
} from "../lib/mmdAiVoicePhase";

const MAX_HISTORY = 12;
const EMPTY_LISTEN_RETRY = 1;

export type ClientMmdAiVoiceContext = {
  screen: string;
  source: string;
  orderId?: string;
  rideId?: string;
};

/**
 * Turn-based ride voice: listen → Whisper STT → /api/ai/chat → TTS → listen.
 * Not duplex WebRTC. Barge-in stops TTS and starts a new listen turn.
 */
export function useClientMmdAiVoiceSession(params: {
  locale: string;
  context: ClientMmdAiVoiceContext;
  enabled: boolean;
}) {
  const [phase, setPhase] = useState<MmdAiVoicePhase>("idle");
  const genRef = useRef(0);
  const phaseRef = useRef<MmdAiVoicePhase>("idle");
  const localeRef = useRef(params.locale);
  const contextRef = useRef(params.context);
  const historyRef = useRef<AiChatHistoryTurn[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const emptyCountRef = useRef(0);
  const enabledRef = useRef(params.enabled);

  localeRef.current = params.locale;
  contextRef.current = params.context;
  enabledRef.current = params.enabled;

  const setPhaseSafe = useCallback((next: MmdAiVoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const halt = useCallback(async () => {
    genRef.current += 1;
    await stopMmdAiSpeech();
    await cancelMmdAiRecording();
  }, []);

  const runTurn = useCallback(async (token: number) => {
    try {
      while (genRef.current === token && enabledRef.current) {
        const appState = AppState.currentState;
        if (appState === "background" || appState === "inactive") {
          setPhaseSafe("ended");
          return;
        }

        setPhaseSafe("listening");
        const uri = await listenUntilSilence();
        if (genRef.current !== token) return;

        if (!uri) {
          emptyCountRef.current += 1;
          if (emptyCountRef.current > EMPTY_LISTEN_RETRY) {
            setPhaseSafe("ended");
            return;
          }
          continue;
        }

        setPhaseSafe("thinking");
        const localeRes = resolveAiVoiceLanguages(localeRef.current);
        const text = (
          await transcribeMmdAiAudio({
            uri,
            locale: localeRes.sttLanguage ?? localeRes.appLocale,
          })
        ).trim();
        if (genRef.current !== token) return;

        if (!text) {
          emptyCountRef.current += 1;
          if (emptyCountRef.current > EMPTY_LISTEN_RETRY) {
            setPhaseSafe("ended");
            return;
          }
          continue;
        }

        emptyCountRef.current = 0;
        historyRef.current = [
          ...historyRef.current,
          { role: "user" as const, content: text },
        ].slice(-MAX_HISTORY);

        const ctx = contextRef.current;
        const response = await postAiChat({
          message: text,
          conversationId: conversationIdRef.current ?? undefined,
          locale: (localeRef.current || "en").split("-")[0],
          context: {
            role: "client",
            screen: ctx.screen,
            orderId: ctx.orderId ?? ctx.rideId,
            source: ctx.source,
          },
          history: historyRef.current,
        });
        if (genRef.current !== token) return;

        conversationIdRef.current = response.conversationId;
        const reply = String(response.message?.content ?? "").trim();
        if (reply) {
          historyRef.current = [
            ...historyRef.current,
            { role: "assistant" as const, content: reply },
          ].slice(-MAX_HISTORY);
          setPhaseSafe("speaking");
          await speakMmdAiReply(reply, localeRef.current);
          if (genRef.current !== token) return;
        }
      }
    } catch {
      if (genRef.current !== token) return;
      await cancelMmdAiRecording();
      await stopMmdAiSpeech();
      setPhaseSafe("error");
    }
  }, [setPhaseSafe]);

  const start = useCallback(async () => {
    if (!enabledRef.current) return;
    await halt();
    const token = ++genRef.current;
    emptyCountRef.current = 0;
    setPhaseSafe("connecting");
    await runTurn(token);
  }, [halt, runTurn, setPhaseSafe]);

  const bargeIn = useCallback(async () => {
    if (!enabledRef.current) return;
    await halt();
    const token = ++genRef.current;
    emptyCountRef.current = 0;
    setPhaseSafe("connecting");
    await runTurn(token);
  }, [halt, runTurn, setPhaseSafe]);

  const onPress = useCallback(() => {
    const action = voiceFabTapAction(phaseRef.current);
    if (action === "stop-listen") {
      requestStopMmdAiListen();
      return;
    }
    if (action === "barge-in") {
      void bargeIn();
      return;
    }
    void start();
  }, [bargeIn, start]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "background" && state !== "inactive") return;
      if (!isVoiceSessionActive(phaseRef.current)) return;
      void halt().then(() => setPhaseSafe("ended"));
    });
    return () => {
      sub.remove();
    };
  }, [halt, setPhaseSafe]);

  useEffect(() => {
    if (params.enabled) return;
    if (!isVoiceSessionActive(phaseRef.current) && phaseRef.current !== "error") {
      return;
    }
    void halt().then(() => setPhaseSafe("idle"));
  }, [halt, params.enabled, setPhaseSafe]);

  useEffect(() => {
    return () => {
      genRef.current += 1;
      void cancelMmdAiRecording();
      void stopMmdAiSpeech();
    };
  }, []);

  return { phase, onPress, start };
}
