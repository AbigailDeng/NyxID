import { useState } from "react";
import {
  ArrowLeft,
  LoaderCircle,
  Power,
  Save,
  ShieldCheck,
} from "lucide-react";

import type { CompanionSettings } from "../domain/companion";
import type { NyxIdView } from "../runtime";
import { NyxIdAccountPanel } from "./nyxid-account-panel";

interface SettingsPanelProps {
  readonly settings: CompanionSettings;
  readonly launchAtLogin: boolean;
  readonly nyxIdView: NyxIdView;
  readonly onClose: () => void;
  readonly onSave: (settings: CompanionSettings) => Promise<CompanionSettings>;
  readonly onSetLaunchAtLogin: (enabled: boolean) => Promise<void>;
  readonly onConnectNyxId: () => Promise<void>;
  readonly onCancelNyxId: () => Promise<void>;
  readonly onRefreshNyxId: () => Promise<void>;
  readonly onLogoutNyxId: () => Promise<void>;
  readonly onOpenNyxIdAssistant: () => Promise<void>;
}

export function SettingsPanel({
  settings,
  launchAtLogin,
  nyxIdView,
  onClose,
  onSave,
  onSetLaunchAtLogin,
  onConnectNyxId,
  onCancelNyxId,
  onRefreshNyxId,
  onLogoutNyxId,
  onOpenNyxIdAssistant,
}: SettingsPanelProps) {
  const [draftOverrides, setDraftOverrides] = useState<
    Partial<CompanionSettings>
  >({});
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [nyxIdActionPending, setNyxIdActionPending] = useState(false);
  const [error, setError] = useState<string>();
  const draft: CompanionSettings = { ...settings, ...draftOverrides };
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  async function save() {
    if (saving || !draft.companionName.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave({
        ...draft,
        companionName: draft.companionName.trim(),
        userName: draft.userName.trim(),
      });
      setDraftOverrides({});
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "设置没有保存，请再试一次",
      );
    } finally {
      setSaving(false);
    }
  }

  async function runNyxIdAction(action: () => Promise<void>) {
    if (nyxIdActionPending) return;
    setNyxIdActionPending(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "NyxID 操作失败，请再试一次",
      );
    } finally {
      setNyxIdActionPending(false);
    }
  }

  async function updateLaunch() {
    setLaunching(true);
    setError(undefined);
    try {
      await onSetLaunchAtLogin(!launchAtLogin);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "开机启动设置失败，请再试一次",
      );
    } finally {
      setLaunching(false);
    }
  }

  return (
    <main
      className="panel settings-panel"
      aria-busy={saving}
      aria-labelledby="settings-title"
    >
      <div className="panel-toolbar" data-window-drag-handle>
        <button
          type="button"
          className="bare-icon"
          aria-label="返回"
          disabled={saving}
          onClick={() => {
            if (!dirty || window.confirm("放弃尚未保存的修改？")) onClose();
          }}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <h1 id="settings-title">陪伴设置</h1>
        <button
          type="button"
          className="save-icon"
          aria-label="保存设置"
          disabled={saving || !dirty || !draft.companionName.trim()}
          onClick={() => void save()}
        >
          {saving ? (
            <LoaderCircle className="is-spinning" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}
        </button>
      </div>
      <fieldset className="settings-scroll settings-fields" disabled={saving}>
        {error ? (
          <p className="form-error form-error--settings" role="alert">
            {error}
          </p>
        ) : null}
        <section className="settings-section">
          <h2>称呼</h2>
          <div className="two-column-fields">
            <label className="field">
              <span>小精灵名字</span>
              <input
                name="companionName"
                autoComplete="off"
                maxLength={24}
                value={draft.companionName}
                onChange={(event) =>
                  setDraftOverrides((current) => ({
                    ...current,
                    companionName: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>你的名字</span>
              <input
                name="userName"
                autoComplete="off"
                maxLength={24}
                value={draft.userName}
                onChange={(event) =>
                  setDraftOverrides((current) => ({
                    ...current,
                    userName: event.target.value,
                  }))
                }
              />
            </label>
          </div>
        </section>
        <section className="settings-section">
          <NyxIdAccountPanel
            view={nyxIdView}
            pending={nyxIdActionPending}
            onConnect={() => runNyxIdAction(onConnectNyxId)}
            onCancel={() => runNyxIdAction(onCancelNyxId)}
            onRefresh={() => runNyxIdAction(onRefreshNyxId)}
            onLogout={() => runNyxIdAction(onLogoutNyxId)}
            onOpenAssistant={() => runNyxIdAction(onOpenNyxIdAssistant)}
          />
        </section>
        <section className="settings-section settings-section--rows">
          <div className="setting-row">
            <div>
              <strong>
                <Power aria-hidden="true" /> 开机启动
              </strong>
              <span>登录电脑后，让小精灵陪着你</span>
            </div>
            <button
              type="button"
              className={`switch-control${launchAtLogin ? " is-on" : ""}`}
              role="switch"
              aria-checked={launchAtLogin}
              aria-label="开机启动"
              disabled={launching}
              onClick={() => void updateLaunch()}
            >
              {launching ? (
                <LoaderCircle className="is-spinning" aria-hidden="true" />
              ) : (
                <span />
              )}
            </button>
          </div>
        </section>
        <section className="privacy-note">
          <ShieldCheck aria-hidden="true" />
          <p>
            语音只在你主动开始通话后使用麦克风。对话和服务授权由 NyxID
            管理，账号凭据保存在系统钥匙串。
          </p>
        </section>
      </fieldset>
    </main>
  );
}
