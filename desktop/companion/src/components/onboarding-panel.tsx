import { useState } from "react";
import { ArrowRight } from "lucide-react";

import type { CompanionSettings } from "../domain/companion";
import { Mascot } from "./mascot";

interface OnboardingPanelProps {
  readonly initialSettings: CompanionSettings;
  readonly onComplete: (settings: CompanionSettings) => Promise<void>;
}

export function OnboardingPanel({
  initialSettings,
  onComplete,
}: OnboardingPanelProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function finish() {
    if (saving || !settings.companionName.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      await onComplete({
        ...settings,
        companionName: settings.companionName.trim(),
        onboardingComplete: true,
      });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "设置没有保存，请再试一次",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main
      className="panel panel--onboarding"
      aria-labelledby="onboarding-title"
    >
      <div className="window-drag-strip" data-window-drag-handle />
      <div className="onboarding-mascot" data-window-drag-handle>
        <Mascot state="waving" size={142} />
      </div>
      <section className="onboarding-step">
        <p className="eyebrow">桌面上的 NyxID</p>
        <h1 id="onboarding-title">给你的小精灵起个名字</h1>
        <p className="onboarding-intro">
          连接 NyxID 后，打字或开口说话，就能让小精灵帮你处理事情。
        </p>
        <label className="field">
          <span>它叫什么</span>
          <input
            autoFocus
            name="companionName"
            autoComplete="off"
            maxLength={24}
            value={settings.companionName}
            disabled={saving}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                companionName: event.target.value,
              }))
            }
            placeholder="Nyx"
          />
        </label>
        <label className="field">
          <span>怎么称呼你</span>
          <input
            name="userName"
            autoComplete="off"
            maxLength={24}
            value={settings.userName}
            disabled={saving}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                userName: event.target.value,
              }))
            }
            placeholder="可不填"
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="primary-button"
          disabled={saving || !settings.companionName.trim()}
          onClick={() => void finish()}
        >
          {saving ? "正在保存" : "开始陪你"}
          <ArrowRight aria-hidden="true" />
        </button>
      </section>
    </main>
  );
}
