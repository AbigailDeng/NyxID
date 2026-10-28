import { useCallback } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import type { ContentScreenProps } from "../../app/navigationTypes";
import { workspaceChatNavigationAction } from "../../app/workspaceChatNavigation";
import { ScreenContainer } from "../ScreenContainer";
import { useTheme } from "../../theme/ThemeContext";
import { fonts } from "../../theme/designTokens";
import { useWorkspaceRecents } from "./useWorkspaceRecents";
import { WorkspaceRecentRow } from "./WorkspaceRecents";
import type { WorkspaceChatTarget } from "../../app/workspaceChatNavigation";
import type { WorkspaceRecent } from "./workspaceSidebarModel";

const recentKey = (item: WorkspaceRecent) => item.key;

export function WorkspaceRecentsScreen({
  navigation,
}: ContentScreenProps<"WorkspaceRecents">) {
  const focused = useIsFocused();
  const { colors } = useTheme();
  const data = useWorkspaceRecents(focused);
  const openChat = useCallback(
    (target: WorkspaceChatTarget) => {
      const action = workspaceChatNavigationAction(
        navigation.getParent()?.getState(),
        target,
      );
      if (action) navigation.dispatch(action);
    },
    [navigation],
  );
  const renderItem = useCallback(
    ({ item }: { item: WorkspaceRecent }) => (
      <WorkspaceRecentRow item={item} onSelect={openChat} />
    ),
    [openChat],
  );
  return (
    <ScreenContainer>
      <FlatList
        data={data.rows}
        keyExtractor={recentKey}
        contentContainerStyle={styles.list}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={data.refreshing}
            onRefresh={() => void data.refresh()}
            tintColor={colors.textMuted}
          />
        }
        ListEmptyComponent={
          <Text style={[styles.note, { color: colors.textMuted }]}>
            {!data.online
              ? "Offline · showing saved recent chats."
              : data.error
                ? "Couldn’t load recent chats. Pull to refresh."
                : data.loading
                  ? "Loading recent chats…"
                  : "No recent chats."}
          </Text>
        }
        ListFooterComponent={
          data.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: !data.active || data.loadingMore,
              }}
              disabled={!data.active || data.loadingMore}
              style={styles.more}
              onPress={data.loadMore}
            >
              <Text style={{ color: colors.textSecondary }}>
                {data.loadingMore ? "Loading older chats…" : "Load older chats"}
              </Text>
            </Pressable>
          ) : null
        }
      />
    </ScreenContainer>
  );
}

/** Replaced by the grouped workspace search in A9's search commit. */
export function WorkspaceSearchScreen() {
  const { colors } = useTheme();
  return (
    <ScreenContainer>
      <View style={styles.list}>
        <Text style={[styles.note, { color: colors.textMuted }]}>
          Search agents, crews and recent chats.
        </Text>
      </View>
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  note: { padding: 12, fontFamily: fonts.bodyRegular, fontSize: 14 },
  more: { minHeight: 44, padding: 12, justifyContent: "center" },
});
