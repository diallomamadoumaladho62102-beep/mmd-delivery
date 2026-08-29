"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";

type RemoteParticipantView = {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasAudio: boolean;
  networkQuality: number | null;
};

type DeviceOption = { deviceId: string; label: string };

const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Twilio Video room UI — tokens come only from the server.
 * Fully wired; live connect requires TWILIO_API_KEY_* on the server.
 */
export default function StaffVideoRoom({
  callId,
  onClose,
}: {
  callId: string;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "reconnecting" | "disconnected"
  >("connecting");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [participants, setParticipants] = useState<RemoteParticipantView[]>([]);
  const [audioDevices, setAudioDevices] = useState<DeviceOption[]>([]);
  const [videoDevices, setVideoDevices] = useState<DeviceOption[]>([]);
  const [audioId, setAudioId] = useState("");
  const [videoId, setVideoId] = useState("");
  const [localNetworkQuality, setLocalNetworkQuality] = useState<number | null>(
    null
  );

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteRootRef = useRef<HTMLDivElement | null>(null);
  const roomRef = useRef<import("twilio-video").Room | null>(null);
  const localTracksRef = useRef<
    Array<
      | import("twilio-video").LocalAudioTrack
      | import("twilio-video").LocalVideoTrack
    >
  >([]);
  const screenTrackRef = useRef<import("twilio-video").LocalVideoTrack | null>(
    null
  );
  const intentionalLeaveRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const connectGenRef = useRef(0);

  const reportEvent = useCallback(
    async (
      action:
        | "leave"
        | "end"
        | "reconnect_failed"
        | "permission_denied"
        | "token_refreshed",
      detail?: string
    ) => {
      await adminFetch(`/api/admin/staff/calls/${callId}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, detail }),
      }).catch(() => undefined);
    },
    [callId]
  );

  const stopLocalTracks = useCallback(() => {
    for (const track of localTracksRef.current) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
    localTracksRef.current = [];
    if (screenTrackRef.current) {
      try {
        screenTrackRef.current.stop();
      } catch {
        /* ignore */
      }
      screenTrackRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }, []);

  const detachAll = useCallback(async () => {
    if (refreshTimerRef.current != null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    const room = roomRef.current;
    if (room) {
      try {
        room.disconnect();
      } catch {
        /* ignore */
      }
      roomRef.current = null;
    }
    stopLocalTracks();
    if (remoteRootRef.current) remoteRootRef.current.replaceChildren();
  }, [stopLocalTracks]);

  const scheduleTokenRefresh = useCallback(
    (refreshAfterSeconds: number) => {
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      const ms = Math.max(30_000, refreshAfterSeconds * 1000);
      refreshTimerRef.current = window.setTimeout(() => {
        void (async () => {
          const res = await adminFetch(
            `/api/admin/staff/calls/${callId}/token`,
            { method: "POST" }
          );
          const body = await res.json().catch(() => ({}));
          if (res.ok && body.ok) {
            await reportEvent("token_refreshed");
            if (typeof body.refreshAfterSeconds === "number") {
              scheduleTokenRefresh(body.refreshAfterSeconds);
            }
            // Twilio Video JS uses room token at connect time; for long calls
            // we reconnect with a fresh token before expiry.
            if (!intentionalLeaveRef.current && roomRef.current) {
              reconnectAttemptsRef.current = 0;
              connectGenRef.current += 1;
              const gen = connectGenRef.current;
              await detachAll();
              if (gen === connectGenRef.current) {
                // trigger reconnect via custom event
                window.dispatchEvent(
                  new CustomEvent("mmd-staff-video-reconnect", {
                    detail: { callId },
                  })
                );
              }
            }
          }
        })();
      }, ms);
    },
    [callId, detachAll, reportEvent]
  );

  useEffect(() => {
    let cancelled = false;
    intentionalLeaveRef.current = false;

    async function connectOnce(isRetry: boolean) {
      if (cancelled || intentionalLeaveRef.current) return;
      setError(null);
      setStatus(isRetry ? "reconnecting" : "connecting");

      try {
        const Video = await import("twilio-video");
        const tokenRes = await adminFetch(
          `/api/admin/staff/calls/${callId}/token`,
          { method: "POST" }
        );
        const tokenBody = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenBody.ok || !tokenBody.token) {
          setError(tokenBody.error ?? "Could not obtain access token");
          setStatus("disconnected");
          return;
        }

        let localTracks: Array<
          | import("twilio-video").LocalAudioTrack
          | import("twilio-video").LocalVideoTrack
        >;
        try {
          const created = await Video.createLocalTracks({
            audio: true,
            video: { width: 640 },
          });
          localTracks = created.filter(
            (
              t
            ): t is
              | import("twilio-video").LocalAudioTrack
              | import("twilio-video").LocalVideoTrack =>
              t.kind === "audio" || t.kind === "video"
          );
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Media permission denied";
          setError(msg);
          setStatus("disconnected");
          await reportEvent("permission_denied", msg);
          return;
        }
        if (cancelled) {
          localTracks.forEach((t) => t.stop());
          return;
        }
        localTracksRef.current = localTracks;

        const localVideo = localTracks.find((t) => t.kind === "video") as
          | import("twilio-video").LocalVideoTrack
          | undefined;
        if (localVideo && localVideoRef.current) {
          localVideo.attach(localVideoRef.current);
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(
          devices
            .filter((d) => d.kind === "audioinput")
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Mic ${d.deviceId.slice(0, 6)}`,
            }))
        );
        setVideoDevices(
          devices
            .filter((d) => d.kind === "videoinput")
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Cam ${d.deviceId.slice(0, 6)}`,
            }))
        );

        const room = await Video.connect(String(tokenBody.token), {
          name: String(tokenBody.roomName),
          tracks: localTracks,
          dominantSpeaker: true,
          networkQuality: { local: 1, remote: 1 },
        });
        if (cancelled || intentionalLeaveRef.current) {
          room.disconnect();
          return;
        }
        roomRef.current = room;
        reconnectAttemptsRef.current = 0;
        setStatus("connected");
        if (typeof tokenBody.refreshAfterSeconds === "number") {
          scheduleTokenRefresh(tokenBody.refreshAfterSeconds);
        }

        const refreshParticipants = () => {
          const list: RemoteParticipantView[] = [];
          room.participants.forEach((p) => {
            list.push({
              sid: p.sid,
              identity: p.identity,
              hasVideo: [...p.videoTracks.values()].some(
                (pub) => pub.isTrackEnabled && pub.track
              ),
              hasAudio: [...p.audioTracks.values()].some(
                (pub) => pub.isTrackEnabled && pub.track
              ),
              networkQuality:
                typeof p.networkQualityLevel === "number"
                  ? p.networkQualityLevel
                  : null,
            });
          });
          setParticipants(list);
        };

        const attachParticipant = (
          participant: import("twilio-video").RemoteParticipant
        ) => {
          const wrap = document.createElement("div");
          wrap.dataset.sid = participant.sid;
          wrap.className =
            "relative overflow-hidden rounded-xl bg-slate-900 aspect-video";
          const label = document.createElement("span");
          label.className =
            "absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white";
          label.textContent = participant.identity;
          wrap.appendChild(label);

          participant.tracks.forEach((publication) => {
            if (
              publication.isSubscribed &&
              publication.track &&
              (publication.track.kind === "audio" ||
                publication.track.kind === "video")
            ) {
              const el = publication.track.attach();
              el.className = "h-full w-full object-cover";
              wrap.appendChild(el);
            }
          });
          participant.on("trackSubscribed", (track) => {
            if (track.kind !== "audio" && track.kind !== "video") return;
            const el = track.attach();
            el.className = "h-full w-full object-cover";
            wrap.appendChild(el);
            refreshParticipants();
          });
          participant.on("trackUnsubscribed", (track) => {
            if (track.kind !== "audio" && track.kind !== "video") return;
            track.detach().forEach((el) => el.remove());
            refreshParticipants();
          });
          participant.on("networkQualityLevelChanged", () => {
            refreshParticipants();
          });
          remoteRootRef.current?.appendChild(wrap);
          refreshParticipants();
        };

        room.participants.forEach(attachParticipant);
        room.on("participantConnected", attachParticipant);
        room.on("participantDisconnected", (p) => {
          remoteRootRef.current
            ?.querySelector(`[data-sid="${p.sid}"]`)
            ?.remove();
          refreshParticipants();
        });
        room.on("reconnecting", () => setStatus("reconnecting"));
        room.on("reconnected", () => setStatus("connected"));
        room.localParticipant.on("networkQualityLevelChanged", (level) => {
          setLocalNetworkQuality(typeof level === "number" ? level : null);
        });
        room.on("disconnected", (_r, err) => {
          if (intentionalLeaveRef.current || cancelled) {
            setStatus("disconnected");
            return;
          }
          setStatus("reconnecting");
          if (err) setError(err.message || "Disconnected");
          void (async () => {
            if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
              setStatus("disconnected");
              await reportEvent(
                "reconnect_failed",
                err?.message ?? "max_retries"
              );
              return;
            }
            reconnectAttemptsRef.current += 1;
            stopLocalTracks();
            roomRef.current = null;
            if (remoteRootRef.current) remoteRootRef.current.replaceChildren();
            await connectOnce(true);
          })();
        });
        refreshParticipants();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Connection failed";
        setError(msg);
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          setStatus("reconnecting");
          window.setTimeout(() => void connectOnce(true), 1500);
        } else {
          setStatus("disconnected");
          await reportEvent("reconnect_failed", msg);
        }
      }
    }

    void connectOnce(false);

    const onReconnect = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { callId?: string };
      if (detail?.callId !== callId) return;
      void connectOnce(true);
    };
    window.addEventListener("mmd-staff-video-reconnect", onReconnect);

    const onBeforeUnload = () => {
      intentionalLeaveRef.current = true;
      void reportEvent("leave", "beforeunload");
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      cancelled = true;
      intentionalLeaveRef.current = true;
      window.removeEventListener("mmd-staff-video-reconnect", onReconnect);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void detachAll();
    };
  }, [
    callId,
    detachAll,
    reportEvent,
    scheduleTokenRefresh,
    stopLocalTracks,
  ]);

  async function toggleMute() {
    const next = !muted;
    for (const track of localTracksRef.current) {
      if (track.kind === "audio") {
        if (next) track.disable();
        else track.enable();
      }
    }
    setMuted(next);
  }

  async function toggleCamera() {
    const next = !cameraOff;
    for (const track of localTracksRef.current) {
      if (track.kind === "video") {
        if (next) track.disable();
        else track.enable();
      }
    }
    setCameraOff(next);
  }

  async function toggleScreenShare() {
    const room = roomRef.current;
    if (!room) return;
    const Video = await import("twilio-video");
    if (sharing && screenTrackRef.current) {
      room.localParticipant.unpublishTrack(screenTrackRef.current);
      screenTrackRef.current.stop();
      screenTrackRef.current = null;
      setSharing(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      const local = new Video.LocalVideoTrack(track, { name: "screen" });
      await room.localParticipant.publishTrack(local);
      screenTrackRef.current = local;
      setSharing(true);
      track.onended = () => {
        void toggleScreenShare();
      };
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Screen share permission denied"
      );
      await reportEvent("permission_denied", "screen_share");
    }
  }

  async function switchAudioDevice(deviceId: string) {
    setAudioId(deviceId);
    const room = roomRef.current;
    if (!room || !deviceId) return;
    const Video = await import("twilio-video");
    const old = localTracksRef.current.find((t) => t.kind === "audio");
    if (old) {
      room.localParticipant.unpublishTrack(old);
      old.stop();
      localTracksRef.current = localTracksRef.current.filter((t) => t !== old);
    }
    const next = await Video.createLocalAudioTrack({
      deviceId: { exact: deviceId },
    });
    await room.localParticipant.publishTrack(next);
    localTracksRef.current.push(next);
    if (muted) next.disable();
  }

  async function switchVideoDevice(deviceId: string) {
    setVideoId(deviceId);
    const room = roomRef.current;
    if (!room || !deviceId) return;
    const Video = await import("twilio-video");
    const old = localTracksRef.current.find((t) => t.kind === "video");
    if (old) {
      room.localParticipant.unpublishTrack(old);
      old.stop();
      localTracksRef.current = localTracksRef.current.filter((t) => t !== old);
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
    }
    const next = await Video.createLocalVideoTrack({
      deviceId: { exact: deviceId },
      width: 640,
    });
    await room.localParticipant.publishTrack(next);
    localTracksRef.current.push(next);
    if (localVideoRef.current) next.attach(localVideoRef.current);
    if (cameraOff) next.disable();
  }

  async function leave(end = false) {
    intentionalLeaveRef.current = true;
    await detachAll();
    await reportEvent(end ? "end" : "leave");
    setStatus("disconnected");
    onClose();
  }

  const qualityLabel = (level: number | null) => {
    if (level == null) return "—";
    if (level >= 4) return "Excellent";
    if (level === 3) return "Good";
    if (level === 2) return "Fair";
    if (level === 1) return "Poor";
    return "Very poor";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Live call</p>
            <p className="text-xs text-slate-500">
              Status: {status}
              {participants.length ? ` · ${participants.length} remote` : ""}
              {" · Network: "}
              {qualityLabel(localNetworkQuality)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void leave(false)}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 p-4 md:grid-cols-2">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">
              You{muted ? " · muted" : ""}
              {cameraOff ? " · cam off" : ""}
            </span>
          </div>
          <div
            ref={remoteRootRef}
            className="grid max-h-[40vh] gap-2 overflow-y-auto md:max-h-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
          <select
            value={audioId}
            onChange={(e) => void switchAudioDevice(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
            title="Microphone"
          >
            <option value="">Default mic</option>
            {audioDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
          <select
            value={videoId}
            onChange={(e) => void switchVideoDevice(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
            title="Camera"
          >
            <option value="">Default camera</option>
            {videoDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void toggleMute()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            onClick={() => void toggleCamera()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          >
            {cameraOff ? "Camera on" : "Camera off"}
          </button>
          <button
            type="button"
            onClick={() => void toggleScreenShare()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          >
            {sharing ? "Stop share" : "Share screen"}
          </button>
          <button
            type="button"
            onClick={() => void leave(false)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          >
            Leave
          </button>
          <button
            type="button"
            onClick={() => void leave(true)}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white"
          >
            End call
          </button>
        </div>

        {participants.length > 0 ? (
          <ul className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
            {participants.map((p) => (
              <li key={p.sid}>
                {p.identity}
                {p.hasAudio ? " · audio" : ""}
                {p.hasVideo ? " · video" : ""}
                {p.networkQuality != null
                  ? ` · net ${qualityLabel(p.networkQuality)}`
                  : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
