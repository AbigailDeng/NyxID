import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { requireOptionalNativeModule } from "expo";
import type { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { getAuthEpoch } from "../../lib/auth/authEpoch";
import { useWorkspaceAccessibility } from "../../lib/accessibility/workspaceAccessibility";

// Expo Go and older installed builds may not contain the speech module.
const speech = requireOptionalNativeModule<typeof ExpoSpeechRecognitionModule>(
  "ExpoSpeechRecognition",
);
// The OS recognizer is shared even when navigation retains multiple chats.
let microphoneOwner: object | undefined;
type Phase = "idle" | "permission" | "listening" | "stopping" | "review";

export function useComposerDictation({
  scope,
  enabled,
  onInsert,
}: {
  scope: string;
  enabled: boolean;
  onInsert: (text: string) => void;
}) {
  const focused = useIsFocused();
  const { sheetOpen } = useWorkspaceAccessibility();
  enabled = enabled && !sheetOpen;
  const epoch = getAuthEpoch();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const review = useRef<
    { scope: string; epoch: number; text: string } | undefined
  >(undefined);
  const current = useRef({ scope, epoch, enabled, focused, onInsert });
  current.current = { scope, epoch, enabled, focused, onInsert };
  const operation = useRef<
    | {
        owner: object;
        cancel: () => void;
        stop: () => void;
      }
    | undefined
  >(undefined);

  function discard() {
    review.current = undefined;
    operation.current?.cancel();
    setPhase("idle");
    setText("");
    setError(undefined);
  }

  useEffect(() => {
    discard();
    return () => operation.current?.cancel();
  }, [scope, epoch, enabled, focused]);

  async function start() {
    if (
      operation.current ||
      current.current.scope !== scope ||
      getAuthEpoch() !== epoch ||
      !current.current.enabled ||
      !current.current.focused ||
      AppState.currentState !== "active"
    )
      return;
    setError(undefined);
    if (!speech) {
      setError(
        "Dictation is available in the updated NyxID app. You can also use your keyboard’s microphone.",
      );
      return;
    }
    if (microphoneOwner || !speech.isRecognitionAvailable()) {
      setError(
        "Speech recognition is unavailable or the microphone is busy. Try your keyboard’s microphone.",
      );
      return;
    }
    const owner = {};
    const identity = { scope, epoch };
    const valid = () =>
      operation.current?.owner === owner &&
      current.current.scope === identity.scope &&
      current.current.epoch === identity.epoch &&
      getAuthEpoch() === identity.epoch &&
      current.current.enabled &&
      current.current.focused;
    const subscriptions: { remove: () => void }[] = [];
    let permission = true;
    let recording = false;
    let transcript = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(timer);
      subscriptions.splice(0).forEach((subscription) => subscription.remove());
      if (microphoneOwner === owner) microphoneOwner = undefined;
      if (operation.current?.owner === owner) operation.current = undefined;
    };
    const cancel = () => {
      // Invalidate listeners before abort, which can synchronously emit end.
      const wasRecording = recording;
      release();
      if (wasRecording) {
        try {
          speech.abort();
        } catch {
          /* Native recognizer already closed. */
        }
      }
    };
    const fail = (message: string) => {
      if (!valid()) return;
      cancel();
      setPhase("idle");
      setText("");
      setError(message);
    };
    const finish = () => {
      if (!valid()) return;
      release();
      review.current = transcript.trim()
        ? { ...identity, text: transcript.trim() }
        : undefined;
      setPhase(transcript.trim() ? "review" : "idle");
      if (!transcript.trim()) setError("No speech was recognized. Try again.");
    };
    const stop = () => {
      if (!valid() || !recording) return;
      setPhase("stopping");
      try {
        speech.stop();
      } catch {
        fail("Dictation could not finish. Try again.");
        return;
      }
      clearTimeout(timer);
      // Bound a recognizer that fails to return its final result/end event.
      timer = setTimeout(() => {
        if (!valid()) return;
        cancel();
        review.current = transcript.trim()
          ? { ...identity, text: transcript.trim() }
          : undefined;
        setPhase(transcript.trim() ? "review" : "idle");
        if (!transcript.trim())
          setError("No speech was recognized. Try again.");
      }, 5000);
    };
    operation.current = { owner, cancel, stop };
    review.current = undefined;
    microphoneOwner = owner;
    setText("");
    setPhase("permission");
    const begin = () => {
      if (
        !valid() ||
        permission ||
        recording ||
        AppState.currentState !== "active"
      )
        return;
      clearTimeout(timer);
      recording = true;
      subscriptions.push(
        speech.addListener("result", (event) => {
          if (!valid() || AppState.currentState !== "active") return;
          // Single-utterance mode is cumulative on both OSes; alternatives are
          // hypotheses, not additional words. Never persist raw audio.
          transcript = [...(event.results[0]?.transcript ?? "")]
            .slice(0, 32768)
            .join("");
          setText(transcript);
        }),
        speech.addListener("end", finish),
        speech.addListener("error", (event) => {
          if (event.error === "aborted") return;
          fail(
            event.error === "not-allowed"
              ? "Allow microphone and speech recognition access in Settings to dictate."
              : event.error === "no-speech"
                ? "No speech was recognized. Try again."
                : "Dictation could not finish. Try again or use your keyboard’s microphone.",
          );
        }),
      );
      try {
        speech.start({
          lang: Intl.DateTimeFormat().resolvedOptions().locale,
          interimResults: true,
          continuous: false,
          maxAlternatives: 1,
          addsPunctuation: true,
          recordingOptions: { persist: false },
        });
        setPhase("listening");
        timer = setTimeout(stop, 60_000);
      } catch {
        fail("Dictation could not start. Try again.");
      }
    };
    subscriptions.push(
      AppState.addEventListener("change", (state) => {
        if (!valid()) return;
        // iOS permission prompts temporarily make the app inactive.
        if (permission) {
          if (state === "background") {
            cancel();
            setPhase("idle");
            setText("");
          }
        } else if (state === "active") begin();
        else {
          cancel();
          setPhase("idle");
          setText("");
        }
      }),
    );
    timer = setTimeout(
      () => fail("Microphone permission took too long. Try again."),
      60_000,
    );
    try {
      const result = await speech.requestPermissionsAsync();
      if (!valid()) return;
      if (!result.granted) {
        fail(
          "Allow microphone and speech recognition access in Settings to dictate.",
        );
        return;
      }
      permission = false;
      clearTimeout(timer);
      // Permission completion can arrive before the active callback.
      timer = setTimeout(
        () => fail("Keep NyxID open to start dictation."),
        5000,
      );
      if (AppState.currentState === "active") {
        clearTimeout(timer);
        begin();
      }
    } catch {
      fail("Microphone permission could not be checked. Try again.");
    }
  }

  return {
    phase,
    text,
    error,
    active: phase !== "idle",
    recording: phase === "listening" || phase === "stopping",
    start,
    stop: () => operation.current?.stop(),
    discard,
    insert: () => {
      const accepted = review.current;
      if (
        phase !== "review" ||
        !current.current.enabled ||
        !current.current.focused ||
        getAuthEpoch() !== epoch ||
        current.current.scope !== scope ||
        !accepted ||
        accepted.scope !== scope ||
        accepted.epoch !== epoch ||
        accepted.text !== text.trim()
      )
        return;
      review.current = undefined;
      current.current.onInsert(accepted.text);
      discard();
    },
  };
}

export type ComposerDictationState = ReturnType<typeof useComposerDictation>;

export function appendDictation(draft: string, text: string) {
  return `${draft}${draft && !/\s$/.test(draft) ? " " : ""}${text}`;
}
