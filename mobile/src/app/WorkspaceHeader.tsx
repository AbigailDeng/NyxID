import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import {
  useIsFocused,
  useNavigation,
  usePreventRemove,
} from "@react-navigation/native";
import type {
  NativeStackNavigationOptions,
  NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import { BackHandler, Pressable, StyleSheet } from "react-native";
import { ChevronLeft, Menu } from "lucide-react-native";
import { useTheme } from "../theme/ThemeContext";
import type { RootStackParamList } from "./AppNavigator";

export const WorkspaceMenuContext = createContext(() => {});

function WorkspaceHeaderButton({
  back = false,
  onPress,
  disabled,
  label,
}: {
  back?: boolean;
  onPress: () => void;
  disabled: boolean;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.button, disabled && styles.disabled]}
    >
      {back ? (
        <ChevronLeft color={colors.textPrimary} size={24} />
      ) : (
        <Menu color={colors.textPrimary} size={22} />
      )}
    </Pressable>
  );
}

export function workspaceHeaderOptions({
  onBack,
  onOpenMenu,
  localBack = false,
  disabled = false,
  label = "Back",
}: {
  onBack: () => void;
  onOpenMenu: () => void;
  localBack?: boolean;
  disabled?: boolean;
  label?: string;
}): NativeStackNavigationOptions {
  const leftButton = (canGoBack?: boolean) => {
    const hasBack = localBack || canGoBack === true;
    return (
      <WorkspaceHeaderButton
        back={hasBack}
        onPress={hasBack ? onBack : onOpenMenu}
        disabled={hasBack && disabled}
        label={hasBack ? label : "Open navigation"}
      />
    );
  };
  const menuButton = (canGoBack?: boolean) =>
    localBack || canGoBack === true ? (
      <WorkspaceHeaderButton
        onPress={onOpenMenu}
        disabled={disabled}
        label="Open navigation"
      />
    ) : null;
  return {
    headerShown: true,
    headerBackVisible: false,
    headerBackButtonMenuEnabled: false,
    headerLeft: ({ canGoBack }) => leftButton(canGoBack),
    headerRight: ({ canGoBack }) => menuButton(canGoBack),
    unstable_headerLeftItems: ({ canGoBack }) => [
      {
        type: "custom",
        element: leftButton(canGoBack),
        hidesSharedBackground: true,
      },
    ],
    unstable_headerRightItems: ({ canGoBack }) => {
      const element = menuButton(canGoBack);
      return element
        ? [{ type: "custom", element, hidesSharedBackground: true }]
        : [];
    },
  };
}

/** Keep a screen's local detail/form history ahead of the native route history. */
export function useWorkspaceBack({
  active,
  onBack,
  disabled = false,
  label = "Back",
}: {
  active: boolean;
  onBack: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const focused = useIsFocused();
  const onOpenMenu = useContext(WorkspaceMenuContext);
  const current = useRef({ onBack, disabled });
  current.current = { onBack, disabled };
  const localBack = useCallback(() => {
    if (!current.current.disabled) current.current.onBack();
  }, []);

  useLayoutEffect(() => {
    if (!focused) return;
    navigation.setOptions({
      ...workspaceHeaderOptions({
        onOpenMenu,
        onBack: active ? localBack : navigation.goBack,
        localBack: active,
        disabled: active && disabled,
        label: active ? label : "Back",
      }),
      gestureEnabled: !active,
    });
  }, [active, disabled, focused, label, localBack, navigation, onOpenMenu]);

  usePreventRemove(focused && active, localBack);

  useEffect(() => {
    if (!focused || !active) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        localBack();
        return true;
      },
    );
    return () => subscription.remove();
  }, [active, focused, localBack]);
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  disabled: { opacity: 0.4 },
});
