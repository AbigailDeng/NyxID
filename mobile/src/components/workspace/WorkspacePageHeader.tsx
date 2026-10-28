import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useTheme } from "../../theme/ThemeContext";
import { fonts } from "../../theme/designTokens";

/** Navigator callbacks return a component; hooks belong to its render. */
export function WorkspacePageHeader(props: NativeStackHeaderProps) {
  return <WorkspacePageHeaderContent {...props} />;
}
function WorkspacePageHeaderContent({
  options,
  route,
  back,
}: NativeStackHeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const props = { canGoBack: !!back, tintColor: colors.textPrimary };
  const title = options.title ?? route.name;
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.bg }}>
      <View
        style={{
          minHeight: 52,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        {options.headerLeft?.(props)}
        <View style={{ flex: 1, minWidth: 0 }}>
          {typeof options.headerTitle === "function" ? (
            options.headerTitle({
              children: title,
              tintColor: colors.textPrimary,
            })
          ) : (
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              maxFontSizeMultiplier={1.25}
              style={{
                color: colors.textPrimary,
                fontFamily: fonts.displaySemi,
                fontSize: 18,
                lineHeight: 24,
              }}
            >
              {typeof options.headerTitle === "string"
                ? options.headerTitle
                : title}
            </Text>
          )}
        </View>
        {options.headerRight?.(props)}
      </View>
    </View>
  );
}
