import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { Camera } from "expo-camera";
import * as Crypto from "expo-crypto";
import { getAuthEpoch } from "../../../lib/auth/authEpoch";
import type { nativeVoiceEnvironment } from "../../../lib/api/assistantVoiceApi";
import { AssistantVoiceClient } from "./AssistantVoiceClient";
import { NativeVoiceMedia } from "./VoiceMediaBridge";
import type {
  VoicePreferences,
  VoiceProtocol,
  VoiceSession,
  VoiceSnapshot,
} from "./voiceContracts";

type Environment = ReturnType<typeof nativeVoiceEnvironment>;

/** iOS permission can resolve before its transient inactive state has ended. */
function waitForVoiceForeground(signal: AbortSignal, valid: () => boolean) {
  if (signal.aborted || !valid())
    return Promise.reject(new Error("Voice start was cancelled."));
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      subscription?.remove();
      clearTimeout(timeout);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const aborted = () => finish(new Error("Voice start was cancelled."));
    const changed = (state: string) => {
      if (signal.aborted || !valid()) aborted();
      else if (state === "active") finish();
      else if (state === "background")
        finish(new Error("Keep NyxID open to start a voice call."));
    };
    signal.addEventListener("abort", aborted, { once: true });
    subscription = AppState.addEventListener("change", changed);
    timeout = setTimeout(
      () =>
        finish(
          new Error(
            "NyxID did not return to the foreground. Open the app and try voice again.",
          ),
        ),
      5000,
    );
    // Cover a state or abort transition between the first check and subscribing.
    changed(AppState.currentState);
  });
}

export function useNativeVoice(
  thread: string,
  environment: Environment,
  onUpdate: () => void,
) {
  const [media, setMedia] = useState<NativeVoiceMedia | null>(null);
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [holding, setHolding] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState<VoiceSession | null>(null);
  const [endingConflict, setEndingConflict] = useState(false);
  const current = useRef<AssistantVoiceClient | null>(null);
  const scope = useRef({ thread, environment });
  scope.current = { thread, environment };
  const latestSnapshot = useRef<VoiceSnapshot | null>(null);
  const taskCancellations = useRef(new Map<string, AbortController>());
  const ticket = useRef(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  const conflictBusy = useRef(false);
  const permissionAttempt = useRef<number | undefined>(undefined);
  const pending = useRef<AbortController | undefined>(undefined);
  const update = useRef(onUpdate);
  update.current = onUpdate;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  function refresh() {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined;
      if (mounted.current && environment.epoch === getAuthEpoch())
        update.current();
    }, 1000);
  }

  function stopLocal() {
    ticket.current++;
    pending.current?.abort();
    for (const controller of taskCancellations.current.values())
      controller.abort();
    taskCancellations.current.clear();
    permissionAttempt.current = undefined;
    busy.current = false;
    conflictBusy.current = false;
    const previous = current.current;
    current.current = null;
    if (previous) void previous.end();
    media?.close();
    if (mounted.current) {
      setStarting(false);
      setConnected(false);
      setHolding(false);
      setEndingConflict(false);
    }
  }

  const stopRef = useRef(stopLocal);
  stopRef.current = stopLocal;
  useEffect(() => {
    mounted.current = true;
    busy.current = false;
    conflictBusy.current = false;
    setMedia(null);
    latestSnapshot.current = null;
    setSnapshot(null);
    setConflict(null);
    setError(undefined);
    setConnected(false);
    setStarting(false);
    setHolding(false);
    setSpeakerMuted(false);
    setEndingConflict(false);
    const subscription = AppState.addEventListener("change", (state) => {
      // System permission prompts may briefly inactivate the app before any
      // microphone is acquired. Actual background always cancels the attempt.
      if (
        state !== "active" &&
        !(state === "inactive" && permissionAttempt.current === ticket.current)
      ) {
        stopRef.current();
        setError(
          "Voice ended while the app was inactive. Start a new call to continue.",
        );
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      stopRef.current();
      clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
    };
  }, [thread, environment]);

  async function start(preferences: VoicePreferences, protocol: VoiceProtocol) {
    if (busy.current || current.current || conflict) return;
    busy.current = true;
    const generation = ++ticket.current;
    const controller = new AbortController();
    pending.current = controller;
    const valid = () =>
      mounted.current &&
      ticket.current === generation &&
      !controller.signal.aborted &&
      getAuthEpoch() === environment.epoch;
    setStarting(true);
    setError(undefined);
    latestSnapshot.current = null;
    setSnapshot(null);
    setSpeakerMuted(false);
    try {
      const options = await environment.api.options(thread, controller.signal);
      if (!valid()) return;
      const selected = options.options.find(
        (option) =>
          option.service_id === preferences.service_id &&
          option.connection_id === preferences.connection_id &&
          option.key_source === preferences.key_source &&
          option.model === preferences.model &&
          option.voice.protocol === protocol,
      );
      if (!selected?.available)
        throw new Error(
          selected?.unavailable_reason ??
            "This voice source is no longer available.",
        );
      await environment.api.savePreferences(preferences, controller.signal);
      if (!valid()) return;
      permissionAttempt.current = generation;
      let permission;
      try {
        permission = await Camera.requestMicrophonePermissionsAsync();
        if (!valid()) return;
        if (!permission.granted)
          throw new Error(
            "Microphone access is off. Allow it in your device settings to use voice; you can keep chatting with text.",
          );
        await waitForVoiceForeground(controller.signal, valid);
      } finally {
        if (permissionAttempt.current === generation)
          permissionAttempt.current = undefined;
      }
      if (!valid()) return;
      const nextMedia = new NativeVoiceMedia();
      const next = new AssistantVoiceClient({
        conversationId: thread,
        media: nextMedia,
        api: environment.api,
        createSocket: environment.createSocket,
        randomId: Crypto.randomUUID,
        onSnapshot: (value) => {
          if (!valid()) return;
          const previous = latestSnapshot.current;
          latestSnapshot.current = value;
          if (
            value.session.state !== "active" ||
            value.session.muted ||
            value.session.input_muted ||
            value.session.end_requested ||
            (previous &&
              previous.session.generation !== value.session.generation)
          )
            setHolding(false);
          setSnapshot(value);
          setStarting(value.session.state === "starting");
          setConnected(
            value.session.state === "active" ||
              value.session.state === "closing",
          );
          refresh();
        },
        onError: (message) => {
          if (valid()) setError(message);
        },
        onConflict: (session) => {
          if (valid()) setConflict(session);
        },
        onClosed: () => {
          if (!valid()) return;
          if (current.current === next) current.current = null;
          setStarting(false);
          setConnected(false);
          setHolding(false);
          refresh();
        },
      });
      current.current = next;
      setMedia(nextMedia);
      setMediaAttempt(generation);
      await next.start(preferences, protocol);
      if (valid() && next.isClosed) current.current = null;
    } catch (cause) {
      if (valid())
        setError(
          cause instanceof Error
            ? cause.message
            : "Voice could not start. Try again.",
        );
    } finally {
      if (valid()) {
        busy.current = false;
        if (!current.current) setStarting(false);
      }
    }
  }

  async function end() {
    stopLocal();
    refresh();
  }

  async function endConflict() {
    if (!conflict || conflictBusy.current) return;
    conflictBusy.current = true;
    const generation = ticket.current;
    const valid = () =>
      mounted.current &&
      ticket.current === generation &&
      environment.epoch === getAuthEpoch();
    setEndingConflict(true);
    setError(undefined);
    try {
      await environment.api.control(thread, conflict.id, {
        command_id: Crypto.randomUUID(),
        expected_revision: conflict.control_revision,
        action: "end",
      });
      if (valid()) {
        setConflict(null);
        refresh();
      }
    } catch {
      if (!valid()) return;
      setError(
        "The existing call could not be ended. Refresh its state and try again.",
      );
      try {
        const active = await environment.api.active(thread);
        if (valid()) setConflict(active.session);
      } catch {
        /* Keep the last verified conflict; do not create another call. */
      }
    } finally {
      if (valid()) {
        conflictBusy.current = false;
        setEndingConflict(false);
      }
    }
  }

  async function stopTask(id: string) {
    const sameScope = () =>
      mounted.current &&
      scope.current.thread === thread &&
      scope.current.environment === environment &&
      environment.epoch === getAuthEpoch();
    if (!sameScope()) return;
    if (current.current) return current.current.stopTask(id);
    const task = latestSnapshot.current?.tasks.find((row) => row.id === id);
    if (
      !task ||
      (task.state !== "queued" && task.state !== "claimed") ||
      taskCancellations.current.has(id)
    )
      return;
    const controller = new AbortController();
    const generation = ticket.current;
    const valid = () =>
      sameScope() &&
      ticket.current === generation &&
      !controller.signal.aborted;
    taskCancellations.current.set(id, controller);
    try {
      await environment.api.cancelRequest(thread, id, controller.signal);
      if (valid()) refresh();
    } catch {
      if (valid())
        setError("The task could not be stopped. Try again from the chat.");
    } finally {
      if (taskCancellations.current.get(id) === controller)
        taskCancellations.current.delete(id);
    }
  }

  return {
    media,
    mediaAttempt,
    starting,
    connected,
    snapshot,
    holding,
    speakerMuted,
    error,
    conflict,
    endingConflict,
    start,
    end,
    endConflict,
    hold(pressed: boolean) {
      setHolding(current.current?.hold(pressed) ?? false);
    },
    mute(muted: boolean) {
      setHolding(false);
      return current.current?.mute(muted);
    },
    muteSpeaker(muted: boolean) {
      current.current?.muteSpeaker(muted);
      setSpeakerMuted(muted);
    },
    resumeAudio() {
      return current.current?.resumeAudio();
    },
    stopTask,
  };
}
