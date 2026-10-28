import { describe, expect, it, vi } from "vitest";

import {
  createDefaultCompanionSettings,
  createDefaultCompanionSnapshot,
} from "../domain/companion";
import {
  BROWSER_SNAPSHOT_KEY,
  BrowserCompanionRuntime,
  NYXID_ASSISTANT_URL,
  type RuntimeStorage,
} from "./browser-runtime";
import { NyxIdChatSendError } from "./chat";

class MemoryStorage implements RuntimeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  serializedValues(): string {
    return JSON.stringify(Object.fromEntries(this.values));
  }
}

describe("browser companion runtime", () => {
  it("persists identity and launch preferences across runtime instances", async () => {
    const storage = new MemoryStorage();
    const first = new BrowserCompanionRuntime({ storage });
    const settings = {
      ...createDefaultCompanionSettings(),
      companionName: "Orbit",
      userName: "Sam",
      onboardingComplete: true,
    };

    await first.saveSettings(settings);
    await first.setLaunchAtLogin(true);
    first.dispose();

    const second = new BrowserCompanionRuntime({ storage });
    expect(await second.snapshot()).toEqual({ schemaVersion: 2, settings });
    expect(await second.getLaunchAtLogin()).toBe(true);
    expect(JSON.parse(storage.getItem(BROWSER_SNAPSHOT_KEY)!)).toEqual({
      schemaVersion: 2,
      settings,
    });
  });

  it("removes retired data from saved legacy snapshots on startup", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      BROWSER_SNAPSHOT_KEY,
      JSON.stringify({
        schemaVersion: 1,
        settings: {
          companionName: "Orbit",
          userName: "Sam",
          onboardingComplete: true,
          meals: [{ id: "lunch", time: "12:00", enabled: true }],
          dietary: ["vegan"],
          quietMode: true,
        },
        history: [{ mealId: "lunch", action: "accepted" }],
        runtime: { activePrompt: { mealId: "lunch" } },
      }),
    );

    const runtime = new BrowserCompanionRuntime({ storage });
    const expected = {
      schemaVersion: 2,
      settings: {
        companionName: "Orbit",
        userName: "Sam",
        onboardingComplete: true,
      },
    };
    expect(await runtime.snapshot()).toEqual(expected);
    expect(JSON.parse(storage.getItem(BROWSER_SNAPSHOT_KEY)!)).toEqual(
      expected,
    );
  });

  it("keeps state independent from returned snapshots and listener mutations", async () => {
    const runtime = new BrowserCompanionRuntime({
      storage: new MemoryStorage(),
    });
    const returned = await runtime.snapshot();
    returned.settings.companionName = "Changed outside runtime";
    const listener = vi.fn();
    await runtime.onStateChanged((snapshot) => {
      snapshot.settings.companionName = "Changed inside listener";
    });
    const unsubscribe = await runtime.onStateChanged(listener);
    const saved = await runtime.saveSettings({
      ...createDefaultCompanionSettings(),
      companionName: "Orbit",
    });

    expect(saved.settings.companionName).toBe("Orbit");
    expect(listener).toHaveBeenCalledWith(saved);
    expect((await runtime.snapshot()).settings.companionName).toBe("Orbit");
    await unsubscribe();
    await runtime.saveSettings(createDefaultCompanionSettings());
    expect(listener).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("does not replace saved identity after invalid settings", async () => {
    const storage = new MemoryStorage();
    const runtime = new BrowserCompanionRuntime({ storage });
    await expect(
      runtime.saveSettings({
        ...createDefaultCompanionSettings(),
        companionName: " ",
      }),
    ).rejects.toThrow();
    expect(await runtime.snapshot()).toEqual(createDefaultCompanionSnapshot());
    expect(JSON.parse(storage.getItem(BROWSER_SNAPSHOT_KEY)!)).toEqual(
      createDefaultCompanionSnapshot(),
    );
  });

  it("recovers corrupt storage and remains usable when persistence is unavailable", async () => {
    const storage = new MemoryStorage();
    storage.setItem(BROWSER_SNAPSHOT_KEY, "invalid JSON");
    const recovered = new BrowserCompanionRuntime({ storage });
    expect(await recovered.snapshot()).toEqual(
      createDefaultCompanionSnapshot(),
    );

    const inaccessible = new BrowserCompanionRuntime({
      storage: {
        getItem() {
          throw new Error("Storage denied");
        },
        setItem() {
          throw new Error("Storage denied");
        },
      },
    });
    const saved = await inaccessible.saveSettings({
      ...createDefaultCompanionSettings(),
      companionName: "Orbit",
    });
    expect(saved.settings.companionName).toBe("Orbit");
    expect(await inaccessible.getLaunchAtLogin()).toBe(false);
    expect(await inaccessible.setLaunchAtLogin(true)).toBe(false);
  });

  it("opens the NyxID assistant with opener isolation", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const runtime = new BrowserCompanionRuntime({
      storage: new MemoryStorage(),
    });

    await runtime.openNyxidAssistant();

    expect(open).toHaveBeenCalledWith(
      NYXID_ASSISTANT_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("keeps NyxID authentication unavailable and out of browser storage", async () => {
    const storage = new MemoryStorage();
    const runtime = new BrowserCompanionRuntime({ storage });
    const listener = vi.fn();

    expect(await runtime.nyxidStatus()).toEqual({ state: "unavailable" });
    expect(await runtime.startNyxidLogin()).toEqual({ state: "unavailable" });
    expect(await runtime.cancelNyxidLogin()).toEqual({ state: "unavailable" });
    expect(await runtime.refreshNyxidCapabilities()).toEqual({
      state: "unavailable",
    });
    expect(await runtime.logoutNyxid()).toEqual({ state: "unavailable" });
    await runtime.onNyxidChanged(listener);

    const persisted = storage.serializedValues().toLocaleLowerCase();
    expect(persisted).not.toContain("access_token");
    expect(persisted).not.toContain("refresh_token");
    expect(persisted).not.toContain("device_code");
    expect(persisted).not.toContain("bearer");
    expect(listener).not.toHaveBeenCalled();
  });

  it("definitely rejects chat that browser preview cannot admit", async () => {
    const runtime = new BrowserCompanionRuntime({
      storage: new MemoryStorage(),
    });

    await expect(
      runtime.sendNyxIdChat({
        requestId: "123e4567-e89b-42d3-a456-426614174000",
        text: "帮我处理",
      }),
    ).rejects.toMatchObject({
      name: "NyxIdChatSendError",
      kind: "rejected",
    } satisfies Partial<NyxIdChatSendError>);
  });
});
