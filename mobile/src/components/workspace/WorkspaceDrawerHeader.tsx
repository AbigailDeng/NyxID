import { StyleSheet, Text, View } from "react-native";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useTheme } from "../../theme/ThemeContext";
import { fonts } from "../../theme/designTokens";

/** iOS centers native stack titles; every nested drawer route shares this row. */
export function WorkspaceDrawerHeader({
  options,
  back,
  route,
}: NativeStackHeaderProps) {
  const { colors } = useTheme();
  const props = { canGoBack: !!back, tintColor: colors.textPrimary };
  return (
    <View style={[styles.header, { backgroundColor: colors.bg }]}>
      {options.headerLeft?.(props)}
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.title, { color: colors.textPrimary }]}
      >
        {options.title ?? route.name}
      </Text>
      {options.headerRight?.(props)}
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingRight: 12,
  },
  title: {
    fontFamily: fonts.displaySemi,
    fontSize: 18,
    lineHeight: 24,
    flex: 1,
  },
});
