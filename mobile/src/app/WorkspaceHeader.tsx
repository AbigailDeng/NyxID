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
import { BackHandler, Pressable, StyleSheet, View } from "react-native";
import { ChevronLeft, Menu } from "lucide-react-native";
import { useTheme } from "../theme/ThemeContext";
import type { RootStackParamList } from "./AppNavigator";

export const WorkspaceMenuContext = createContext(() => {});

function WorkspaceHeaderButtons({
  canGoBack,
  onBack,
  onOpenMenu,
  disabled,
  label,
}: {
  canGoBack: boolean;
  onBack: () => void;
  onOpenMenu: () => void;
  disabled: boolean;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.controls}>
      {canGoBack && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          style={[styles.button, disabled && styles.disabled]}
        >
          <ChevronLeft color={colors.textPrimary} size={24} />
        </Pressable>
      )}
      <Pressable
        onPress={onOpenMenu}
        accessibilityRole="button"
        accessibilityLabel="Open navigation"
        style={styles.button}
      >
        <Menu color={colors.textPrimary} size={22} />
      </Pressable>
    </View>
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
  const buttons = (canGoBack?: boolean) => (
    <WorkspaceHeaderButtons
      canGoBack={localBack || canGoBack === true}
      onBack={onBack}
      onOpenMenu={onOpenMenu}
      disabled={disabled}
      label={label}
    />
  );
  return {
    headerShown: true,
    headerBackVisible: false,
    headerBackButtonMenuEnabled: false,
    headerLeft: ({ canGoBack }) => buttons(canGoBack),
    unstable_headerLeftItems: ({ canGoBack }) => [
      {
        type: "custom",
        element: buttons(canGoBack),
        hidesSharedBackground: true,
      },
    ],
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
  controls: { flexDirection: "row", marginLeft: -8 },
  button: {
    minWidth: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  disabled: { opacity: 0.4 },
});
