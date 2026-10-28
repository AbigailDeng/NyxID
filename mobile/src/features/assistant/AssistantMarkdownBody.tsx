import { memo, useMemo } from "react";
import { Text } from "react-native";
import Markdown, {
  MarkdownIt,
  type RenderRules,
} from "react-native-markdown-display";
import * as WebBrowser from "expo-web-browser";
import { useTheme } from "../../theme/ThemeContext";
import { fonts, radius } from "../../theme/designTokens";
import { assistantSelectableMarkdown } from "./assistantSelectableMarkdown";
import {
  assistantMarkdownOptions,
  safeAssistantLinkUrl,
} from "./assistantMarkdown";

const markdown = MarkdownIt(assistantMarkdownOptions);
markdown.validateLink = (url: string) => safeAssistantLinkUrl(url) !== null;
function openLink(url: string) {
  const safe = safeAssistantLinkUrl(url);
  if (safe) void WebBrowser.openBrowserAsync(safe).catch(() => undefined);
  return false;
}

/** Stable message bodies avoid reparsing earlier replies on every composer edit. */
export const AssistantMarkdownBody = memo(function AssistantMarkdownBody({
  text,
  variant = "private",
  onLinkPress = openLink,
}: {
  text: string;
  variant?: "private" | "crew";
  onLinkPress?: (url: string) => boolean;
}) {
  const { colors } = useTheme();
  const markdownStyle = useMemo(
    () => ({
      body: {
        color: colors.textPrimary,
        fontFamily: fonts.bodyRegular,
        fontSize: 14,
        lineHeight: 23,
      },
      paragraph: { marginTop: 0, marginBottom: 10 },
      heading1: {
        fontFamily: fonts.displaySemi,
        fontSize: 22,
        lineHeight: 29,
        color: colors.textPrimary,
      },
      heading2: {
        fontFamily: fonts.displaySemi,
        fontSize: 18,
        lineHeight: 25,
        color: colors.textPrimary,
      },
      link: {
        color: colors.primaryOnTint,
        textDecorationLine: "underline" as const,
      },
      code_inline: {
        fontFamily: fonts.mono,
        backgroundColor: colors.cardSoft,
        color: colors.textPrimary,
      },
      fence: {
        fontFamily: fonts.mono,
        fontSize: 12,
        backgroundColor: colors.cardSoft,
        color: colors.textPrimary,
        borderColor: colors.border,
        borderRadius: radius.md,
      },
      blockquote: {
        backgroundColor: colors.cardSoft,
        borderColor: colors.primary,
        color: colors.textSecondary,
      },
      table: { borderColor: colors.border },
      tr: { borderColor: colors.border },
    }),
    [colors],
  );

  const crewStyle = useMemo(
    () => ({
      body: {
        color: colors.textPrimary,
        fontSize: 14,
        lineHeight: 23,
        fontFamily: fonts.bodyRegular,
      },
      paragraph: { marginTop: 0, marginBottom: 8 },
      link: { color: colors.primaryOnTint },
      fence: {
        backgroundColor: colors.cardSoft,
        color: colors.textPrimary,
        borderColor: colors.border,
        fontFamily: fonts.mono,
      },
      code_inline: {
        backgroundColor: colors.cardSoft,
        color: colors.textPrimary,
      },
      heading1: { fontSize: 22, color: colors.textPrimary },
      heading2: { fontSize: 18, color: colors.textPrimary },
    }),
    [colors],
  );
  const rules: RenderRules = useMemo(
    () => ({
      ...assistantSelectableMarkdown,
      ...(variant === "private"
        ? ({
            link: (node, children) => (
              <Text
                key={node.key}
                accessibilityRole="link"
                style={markdownStyle.link}
                onPress={() => onLinkPress(node.attributes.href)}
              >
                {children}
              </Text>
            ),
          } satisfies RenderRules)
        : {}),
      image: (node) => (
        <Text
          key={node.key}
          style={{ color: colors.primaryOnTint }}
          onPress={() => {
            if (typeof node.attributes.src === "string")
              onLinkPress(node.attributes.src);
          }}
        >
          {typeof node.attributes.alt === "string" && node.attributes.alt.trim()
            ? node.attributes.alt
            : "Image"}
        </Text>
      ),
    }),
    [variant, markdownStyle, colors, onLinkPress],
  );
  return (
    <Markdown
      markdownit={markdown}
      mergeStyle
      style={variant === "crew" ? crewStyle : markdownStyle}
      rules={rules}
      onLinkPress={onLinkPress}
    >
      {text}
    </Markdown>
  );
});
