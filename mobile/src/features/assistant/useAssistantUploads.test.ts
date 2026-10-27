import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { deferred, hookHarness } from "./assistantHookTestHarness";
import type { useAssistantUploads } from "./useAssistantUploads";

function harness(platform = "android") {
  let state = "active";
  let epoch = 1;
  let focused = true;
  const listeners = new Set<(state: string) => void>();
  const picker = deferred<unknown>();
  const photoPicker = deferred<unknown>();
  const calls: { source: string; options: any }[] = [];
  let choices: { text: string; onPress?: () => void }[] = [];
  let iosChoice: ((index: number) => void) | undefined;
  let conversionError = false;
  let installed = true;
  const disposed: string[] = [];
  const requests: string[] = [];
  const props = { model: "model", generation: 0, enabled: true, online: true };
  class File {
    constructor(readonly uri: string) {}
    get exists() {
      return !disposed.includes(this.uri);
    }
    size = 3;
    delete() {
      disposed.push(this.uri);
    }
    open() {
      return { readBytes: () => new Uint8Array([1, 2, 3]), close() {} };
    }
  }
  const h = hookHarness<ReturnType<typeof useAssistantUploads>>({
    expo: { requireOptionalNativeModule: () => (installed ? {} : null) },
    "react-native": {
      Platform: { OS: platform },
      Alert: {
        alert: (_: unknown, __: unknown, buttons: typeof choices) => {
          choices = buttons;
        },
      },
      ActionSheetIOS: {
        showActionSheetWithOptions: (_: unknown, cb: typeof iosChoice) => {
          iosChoice = cb;
        },
      },
      AppState: {
        get currentState() {
          return state;
        },
        addEventListener: (_: string, cb: (state: string) => void) => {
          listeners.add(cb);
          return { remove: () => listeners.delete(cb) };
        },
      },
    },
    "@react-navigation/native": { useIsFocused: () => focused },
    "expo-document-picker": {
      getDocumentAsync: (options: unknown) => {
        calls.push({ source: "files", options });
        return picker.promise;
      },
    },
    "expo-image-picker": {
      UIImagePickerPreferredAssetRepresentationMode: {
        Compatible: "compatible",
      },
      launchImageLibraryAsync: (options: unknown) => {
        calls.push({ source: "photos", options });
        return photoPicker.promise;
      },
    },
    "expo-image-manipulator": {
      SaveFormat: { JPEG: "jpeg" },
      ImageManipulator: {
        manipulate: () => ({
          renderAsync: async () => {
            if (conversionError) throw new Error("Could not convert photo.");
            return {
              saveAsync: async () => ({ uri: "file:///cache/converted.jpg" }),
              release() {},
            };
          },
          release() {},
        }),
      },
    },
    "expo-file-system": { File, Paths: { cache: { uri: "file:///cache/" } } },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "../../lib/api/assistantUploadsApi": {
      assistantUploadsApi: {
        createDraft: async () => {
          requests.push("draft");
          return "draft-1";
        },
        upload: async () => {
          requests.push("upload");
          return {
            id: "file-1",
            label: "note.txt",
            size: 3,
            content_type: "text/plain",
            origin: "user_upload",
          };
        },
        remove: async () => {},
      },
    },
    "../../lib/api/assistantApi": {
      assistantApi: { changeModel: async () => {} },
    },
  });
  const hook = h.load(
    fileURLToPath(new URL("./useAssistantUploads.ts", import.meta.url)),
  ).useAssistantUploads as typeof useAssistantUploads;
  h.mount(() => hook(props));
  return {
    h,
    props,
    requests,
    disposed,
    calls,
    picker,
    photoPicker,
    choose: (source: "files" | "photos") => {
      if (platform === "ios") iosChoice?.(source === "photos" ? 0 : 1);
      else
        choices
          .find(
            (button) =>
              button.text === (source === "photos" ? "Photos" : "Files"),
          )
          ?.onPress?.();
    },
    conversionError: () => {
      conversionError = true;
    },
    removeNativeModules: () => {
      installed = false;
    },
    emit: (next: string) => {
      state = next;
      for (const cb of listeners) cb(next);
    },
    changeOwner: () => {
      epoch++;
    },
    blur: () => {
      focused = false;
    },
    finish: () =>
      picker.resolve({
        canceled: false,
        assets: [
          {
            uri: "file:///cache/DocumentPicker/note.txt",
            name: "note.txt",
            mimeType: "text/plain",
            size: 3,
          },
        ],
      }),
  };
}

test("Android result before resume retains the file but starts no work until active effects commit", async () => {
  const x = harness();
  const picking = x.h.value().pick();
  x.emit("background");
  x.h.flush();
  x.finish();
  await picking;
  await x.h.settle();
  assert.deepEqual(x.requests, []);
  assert.deepEqual(x.disposed, []);
  assert.equal(x.h.value().files.length, 0);
  x.emit("active");
  await x.h.settle();
  assert.deepEqual(x.requests, ["draft", "upload"]);
  assert.equal(x.h.value().files[0]?.progress, 100);
  assert.equal(x.h.value().files[0]?.error, undefined);
  assert.deepEqual(x.disposed, []);
  x.h.unmount();
});

test("plus chooser routes Photos and Files to their respective native pickers on both platforms", async () => {
  for (const platform of ["ios", "android"]) {
    for (const source of ["files", "photos"] as const) {
      const x = harness(platform);
      x.h.value().choose();
      assert.equal(x.calls.length, 0);
      x.choose(source);
      await x.h.settle();
      assert.equal(x.calls[0]?.source, source);
      assert.equal(x.calls.length, 1);
      if (source === "photos") {
        assert.deepEqual(Array.from(x.calls[0]!.options.mediaTypes), [
          "images",
        ]);
        assert.equal(x.calls[0]!.options.selectionLimit, 10);
        x.photoPicker.resolve({ canceled: true });
      } else x.picker.resolve({ canceled: true });
      await x.h.settle();
      assert.deepEqual(x.requests, []);
      x.h.unmount();
    }
  }
});

test("late chooser actions cannot open a picker for an obsolete account, chat or disabled composer", async () => {
  for (const invalidate of ["account", "chat", "permission", "unmount"]) {
    const x = harness();
    x.h.value().choose();
    if (invalidate === "account") x.changeOwner();
    if (invalidate === "chat") x.props.generation++;
    if (invalidate === "permission") x.props.enabled = false;
    if (invalidate === "unmount") x.h.unmount();
    else x.h.render();
    x.choose("photos");
    assert.equal(x.calls.length, 0, invalidate);
    if (invalidate !== "unmount") x.h.unmount();
  }
});

test("Photos waits for foreground, converts HEIC and reuses the upload session", async () => {
  const x = harness();
  const picked = x.h.value().pick("photos");
  await x.h.settle();
  x.emit("background");
  x.h.flush();
  x.photoPicker.resolve({
    canceled: false,
    assets: [
      {
        uri: "file:///cache/photo.heic",
        fileName: "Camera.HEIC",
        mimeType: "image/heic",
        fileSize: 3,
      },
    ],
  });
  await picked;
  await x.h.settle();
  assert.deepEqual(x.requests, []);
  assert.deepEqual(x.disposed, ["file:///cache/photo.heic"]);
  x.emit("active");
  await x.h.settle();
  assert.deepEqual(x.requests, ["draft", "upload"]);
  assert.equal(x.h.value().files[0]?.file.name, "Camera.jpg");
  assert.equal(x.h.value().files[0]?.file.mimeType, "image/jpeg");
  x.h.unmount();
});

test("photo results and converted cache copies cannot cross account or focus boundaries", async () => {
  for (const change of ["account", "focus"]) {
    const x = harness();
    const picked = x.h.value().pick("photos");
    await x.h.settle();
    if (change === "account") x.changeOwner();
    else x.blur();
    x.h.render();
    x.photoPicker.resolve({
      canceled: false,
      assets: [
        {
          uri: "file:///cache/photo.heic",
          fileName: "photo.heic",
          mimeType: "image/heic",
          fileSize: 3,
        },
      ],
    });
    await picked;
    await x.h.settle();
    assert.deepEqual(x.requests, []);
    assert.deepEqual(x.disposed, ["file:///cache/photo.heic"]);
    x.h.unmount();
  }
});

test("account changes while loading the photo module cannot open its native picker", async () => {
  const x = harness();
  const picking = x.h.value().pick("photos");
  x.changeOwner();
  x.h.render();
  await picking;
  await x.h.settle();
  assert.deepEqual(x.calls, []);
  assert.deepEqual(x.requests, []);
  x.h.unmount();
});

test("failed conversion disposes every selected cache copy and reports a recoverable error", async () => {
  const x = harness();
  x.conversionError();
  const picked = x.h.value().pick("photos");
  x.photoPicker.resolve({
    canceled: false,
    assets: [
      {
        uri: "file:///cache/photo.heic",
        fileName: "photo.heic",
        mimeType: "image/heic",
        fileSize: 3,
      },
    ],
  });
  await picked;
  await x.h.settle();
  assert.deepEqual(x.requests, []);
  assert.deepEqual(x.disposed, ["file:///cache/photo.heic"]);
  assert.match(x.h.value().error!, /picker could not open/);
  assert.equal(x.h.value().picking, false);
  x.h.unmount();
});

test("an older native build reports Photos availability without breaking Files or chat startup", async () => {
  const x = harness();
  x.removeNativeModules();
  await x.h.value().pick("photos");
  await x.h.settle();
  assert.match(x.h.value().error!, /updated NyxID app/);
  assert.equal(x.calls.length, 0);
  assert.equal(x.h.value().picking, false);
  const file = x.h.value().pick("files");
  x.finish();
  await file;
  await x.h.settle();
  assert.deepEqual(x.requests, ["draft", "upload"]);
  x.h.unmount();
});

test("resume before result and a batched background/result/resume each upload exactly once", async () => {
  for (const commitBackground of [true, false]) {
    const x = harness();
    const picking = x.h.value().pick();
    x.emit("background");
    if (commitBackground) x.h.flush();
    x.emit("active");
    x.finish();
    await picking;
    await x.h.settle();
    assert.deepEqual(x.requests, ["draft", "upload"]);
    assert.equal(x.h.value().files[0]?.error, undefined);
    x.h.unmount();
  }
});

test("pending picker copies never cross owner/chat/focus/permission/connectivity or unmount boundaries", async () => {
  for (const invalidation of [
    "owner",
    "generation",
    "focus",
    "enabled",
    "online",
    "unmount",
  ] as const) {
    const x = harness();
    const picking = x.h.value().pick();
    x.emit("background");
    x.h.flush();
    x.finish();
    await picking;
    await x.h.settle();
    if (invalidation === "owner") x.changeOwner();
    else if (invalidation === "generation") x.props.generation++;
    else if (invalidation === "focus") x.blur();
    else if (invalidation === "enabled") x.props.enabled = false;
    else if (invalidation === "online") x.props.online = false;
    if (invalidation === "unmount") {
      x.h.unmount();
      await new Promise<void>((r) => setImmediate(r));
    } else {
      x.h.render();
      x.emit("active");
      await x.h.settle();
    }
    assert.deepEqual(x.requests, [], invalidation);
    assert.deepEqual(
      x.disposed,
      ["file:///cache/DocumentPicker/note.txt"],
      invalidation,
    );
    if (invalidation !== "unmount") x.h.unmount();
  }
});
