import { WorkspaceInteractionSurface } from "../lib/accessibility/WorkspaceInteractionSurface";
import { useWorkspaceAccessibility } from "../lib/accessibility/workspaceAccessibility";
import { workspaceFocus } from "../lib/accessibility/workspaceFocus";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  useIsFocused,
  useNavigation,
  usePreventRemove,
  type NavigationAction,
} from "@react-navigation/native";
import type {
  NativeStackNavigationOptions,
  NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import {
  Alert,
  BackHandler,
  findNodeHandle,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { ChevronLeft, Menu, X } from "lucide-react-native";
import { useTheme } from "../theme/ThemeContext";
import type { RootStackParamList } from "./AppNavigator";
import type { AssistantParams } from "./navigationTypes";

export const WorkspaceSessionContext = createContext(true);
export const WorkspaceSheetContext = createContext<{
  registerDismissGuard?: (
    id: symbol,
    guard: () => Promise<boolean>,
  ) => () => void;
  dismissAuthorized?: boolean;
  rootKey: string;
  sheetKey: string;
  onClose: () => void;
  onOpenChat: (params?: AssistantParams) => void;
  onOpenGroup: (groupId: string) => void;
} | null>(null);

export function useWorkspaceSheet() {
  return useContext(WorkspaceSheetContext);
}

/** A chat selected inside a drawer replaces the entire drawer on the root. */
export function useOpenWorkspaceChat() {
  const sheet = useContext(WorkspaceSheetContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (params?: AssistantParams) => {
    if (sheet) sheet.onOpenChat(params);
    else navigation.push("AssistantContext", params);
  };
}

export const WorkspaceMenuContext = createContext(() => {});
export type WorkspaceNavigationGuardChange = (
  id: symbol,
  blocked: boolean,
) => void;
export const WorkspaceNavigationGuardContext =
  createContext<WorkspaceNavigationGuardChange>(() => {});

export function WorkspaceHeaderVisibility({
  children,
}: {
  children: React.ReactNode;
}) {
  const sheet = useContext(WorkspaceSheetContext);
  return (
    <WorkspaceInteractionSurface inSheet={Boolean(sheet)}>
      {children}
    </WorkspaceInteractionSurface>
  );
}

export type WorkspaceHeaderRole = "menu" | "back";

function WorkspaceHeaderButton({
  back = false,
  close = false,
  onPress,
  disabled,
  label,
}: {
  back?: boolean;
  close?: boolean;
  onPress: () => void;
  disabled: boolean;
  label: string;
}) {
  const { colors } = useTheme();
  const sheet = useContext(WorkspaceSheetContext);
  const control = useRef<View>(null);
  const focused = useIsFocused();
  const owner = useRef(Symbol("primary-header-control")).current;
  useEffect(() => () => workspaceFocus.release(owner), [owner]);
  const { sheetOpen, primaryKey } = useWorkspaceAccessibility();
  const hidden = !focused || (sheetOpen && !sheet);
  const primaryScope = useRef(primaryKey);
  if (focused && !sheet && !sheetOpen) primaryScope.current = primaryKey;
  useLayoutEffect(() => {
    if (sheet) return;
    workspaceFocus.register(
      owner,
      () => findNodeHandle(control.current),
      !hidden,
      primaryScope.current,
    );
  }, [owner, hidden, primaryKey, Boolean(sheet)]);
  return (
    <Pressable
      ref={control}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      accessible={!hidden}
      onPress={() => {
        if (!sheet) workspaceFocus.invoked(owner);
        onPress();
      }}
      onLayout={() => {
        if (sheet && close)
          workspaceFocus.focusDrawerOnce(sheet.sheetKey, () =>
            findNodeHandle(control.current),
          );
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[
        styles.button,
        close && { borderRadius: 22, backgroundColor: colors.navActive },
        disabled && styles.disabled,
      ]}
    >
      {close ? (
        <X color={colors.textPrimary} size={22} />
      ) : back ? (
        <ChevronLeft color={colors.textPrimary} size={24} />
      ) : (
        <Menu color={colors.textPrimary} size={22} />
      )}
    </Pressable>
  );
}

export function workspaceHeaderOptions({
  role,
  onBack,
  onOpenMenu,
  onClose,
  disabled = false,
  label = "Back",
}: {
  onOpenMenu: () => void;
  onClose?: () => void;
  disabled?: boolean;
  label?: string;
} & (
  | { role: "menu"; onBack?: () => void }
  | { role: "back"; onBack: () => void }
)): NativeStackNavigationOptions {
  const leftButton = () =>
    onClose && role === "menu" ? null : (
      <WorkspaceHeaderButton
        back={role === "back"}
        onPress={role === "back" ? onBack : onOpenMenu}
        disabled={disabled}
        label={role === "back" ? label : "Open navigation"}
      />
    );
  const closeButton = () =>
    onClose ? (
      <WorkspaceHeaderButton
        close
        onPress={onClose}
        disabled={disabled}
        label="Close drawer"
      />
    ) : null;
  return {
    headerShown: true,
    headerBackVisible: false,
    headerBackButtonMenuEnabled: false,
    headerLeft: leftButton,
    // Clear both right-side options when setOptions merges a previous header.
    headerRight: closeButton,
    unstable_headerLeftItems: () =>
      onClose && role === "menu"
        ? []
        : [
            {
              type: "custom",
              element: leftButton()!,
              hidesSharedBackground: true,
            },
          ],
    unstable_headerRightItems: () =>
      onClose
        ? [
            {
              type: "custom",
              element: closeButton()!,
              hidesSharedBackground: true,
            },
          ]
        : [],
  };
}

/** Keep a screen's local detail/form history ahead of the native route history. */
export function useWorkspaceBack({
  active,
  onBack,
  defaultRole = "menu",
  disabled = false,
  label = "Back",
  options,
  discardOnClose,
}: {
  active: boolean;
  onBack: () => void;
  defaultRole?: WorkspaceHeaderRole;
  disabled?: boolean;
  label?: string;
  /** Screen-specific title/actions must be applied with the navigation role. */
  options?: NativeStackNavigationOptions;
  /** Dirty forms confirm an outer drawer dismissal independently of local Back. */
  discardOnClose?: { title: string; message: string };
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const focused = useIsFocused();
  const sessionActive = useContext(WorkspaceSessionContext);
  const onOpenMenu = useContext(WorkspaceMenuContext);
  const sheet = useContext(WorkspaceSheetContext);
  const onNavigationGuardChange = useContext(WorkspaceNavigationGuardContext);
  const guardId = useRef(Symbol("workspace-navigation-guard"));
  const current = useRef({ onBack, disabled, focused });
  const mounted = useRef(true);
  const [allowedRemoval, setAllowedRemoval] = useState<NavigationAction>();
  const allowedFocus = useRef(true);
  current.current = { onBack, disabled, focused };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const localBack = useCallback(() => {
    if (!current.current.disabled) current.current.onBack();
  }, []);

  useLayoutEffect(() => {
    if (!focused) return;
    navigation.setOptions({
      ...workspaceHeaderOptions({
        role: active ? "back" : defaultRole,
        onOpenMenu,
        onClose: sheet?.onClose,
        onBack: active ? localBack : navigation.goBack,
        disabled,
        label: active ? label : "Back",
      }),
      gestureEnabled: !disabled && (!active || Boolean(sheet)),
      ...options,
    });
  }, [
    active,
    defaultRole,
    disabled,
    focused,
    label,
    localBack,
    navigation,
    onOpenMenu,
    options,
    sheet,
  ]);

  useEffect(() => {
    if (
      !sessionActive ||
      !sheet?.registerDismissGuard ||
      (!discardOnClose && !(focused && disabled))
    )
      return;
    return sheet.registerDismissGuard(guardId.current, async () => {
      if (current.current.disabled) return false;
      if (!discardOnClose) return true;
      return new Promise<boolean>((resolve) => {
        Alert.alert(
          discardOnClose.title,
          discardOnClose.message,
          [
            {
              text: "Keep editing",
              style: "cancel",
              onPress: () => resolve(false),
            },
            {
              text: "Discard",
              style: "destructive",
              onPress: () =>
                resolve(mounted.current && !current.current.disabled),
            },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
    });
  }, [
    sessionActive,
    sheet?.registerDismissGuard,
    Boolean(discardOnClose),
    discardOnClose?.title,
    discardOnClose?.message,
    disabled,
    focused,
  ]);

  usePreventRemove(
    sessionActive &&
      !sheet?.dismissAuthorized &&
      ((focused && (active || disabled)) || Boolean(discardOnClose)) &&
      (!allowedRemoval || disabled),
    ({ data }) => {
      const outerDismiss =
        sheet &&
        (data.action.target === sheet.rootKey ||
          data.action.source === sheet.sheetKey);
      if (!outerDismiss) {
        localBack();
        return;
      }
      if (current.current.disabled) return;
      const focusWhenRequested = current.current.focused;
      const proceed = () => {
        if (
          mounted.current &&
          current.current.focused === focusWhenRequested &&
          !current.current.disabled
        ) {
          allowedFocus.current = focusWhenRequested;
          setAllowedRemoval(data.action);
        }
      };
      if (discardOnClose) {
        Alert.alert(discardOnClose.title, discardOnClose.message, [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: proceed },
        ]);
      } else proceed();
    },
  );

  // Replay the exact parent action after React has removed this route's guard.
  // Replacing it with a child goBack would only move one level inside the drawer.
  useEffect(() => {
    if (!allowedRemoval) return;
    if (
      mounted.current &&
      current.current.focused === allowedFocus.current &&
      !current.current.disabled
    )
      navigation.dispatch(allowedRemoval);
    setAllowedRemoval(undefined);
  }, [allowedRemoval, navigation]);

  // Defer external approval navigation while a critical write forbids leaving.
  // Local detail Back handling remains independent from notification delivery.
  useLayoutEffect(() => {
    if ((!focused || !disabled) && !discardOnClose) return;
    const id = guardId.current;
    onNavigationGuardChange(id, true);
    return () => onNavigationGuardChange(id, false);
  }, [disabled, Boolean(discardOnClose), focused, onNavigationGuardChange]);

  useEffect(() => {
    if (!focused || (!active && !disabled)) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        localBack();
        return true;
      },
    );
    return () => subscription.remove();
  }, [active, disabled, focused, localBack]);
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  disabled: { opacity: 0.4 },
});
