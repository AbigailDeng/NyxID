import { useState, type ReactElement } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { SvgUri } from "react-native-svg";
import { useTheme } from "../theme/ThemeContext";
import { fonts } from "../theme/designTokens";

/** Match Web's public icon URLs; never pass them through authenticated API calls. */
export function serviceIconSource(value?: string | null) {
  if (!value || value.length > 2048 || value.includes("#")) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return {
      uri: url.href,
      // Database uploads are SVGs served by an extensionless public endpoint.
      svg:
        /\/catalog-icons\/[^/]+\/?$/i.test(url.pathname) ||
        /\.svg$/i.test(url.pathname),
    };
  } catch {
    return null;
  }
}

const ignoreSvgError = () => {};

export function ServiceIcon({
  iconUrl,
  initial,
  color,
}: {
  iconUrl?: string | null;
  initial: string;
  color: string;
}) {
  const { colors } = useTheme();
  const source = serviceIconSource(iconUrl);
  const fallback = <Text style={[styles.initial, { color }]}>{initial}</Text>;
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { backgroundColor: colors.ghostBg }]}
    >
      {source ? (
        <RemoteIcon
          key={source.uri}
          source={source}
          color={colors.textSecondary}
          fallback={fallback}
        />
      ) : (
        fallback
      )}
    </View>
  );
}

function RemoteIcon({
  source,
  color,
  fallback,
}: {
  source: NonNullable<ReturnType<typeof serviceIconSource>>;
  color: string;
  fallback: ReactElement;
}) {
  const [trySvg, setTrySvg] = useState(source.svg);
  if (trySvg)
    return (
      <SvgUri
        uri={source.uri}
        width={24}
        height={24}
        color={color}
        fallback={fallback}
        onError={ignoreSvgError}
      />
    );
  return (
    <Image
      accessible={false}
      source={{ uri: source.uri }}
      resizeMode="contain"
      style={styles.image}
      // An external SVG can also have an opaque URL. If the native image
      // decoder cannot load it, try SVG before showing the fallback.
      onError={() => setTrySvg(true)}
    />
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
  },
  image: { width: 24, height: 24 },
  initial: { fontFamily: fonts.bodySemi, fontSize: 14 },
});
