import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "@/context/EventContext";
import { useColors } from "@/hooks/useColors";
import {
  MediaItem,
  useListEventMedia,
} from "@workspace/api-client-react";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;

function mediaUrl(objectPath: string) {
  return `https://${DOMAIN}/api/storage/objects/${objectPath}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MediaCard({
  item,
  colors,
}: {
  item: MediaItem;
  colors: ReturnType<typeof useColors>;
}) {
  const isVoice = item.mediaType === "voice_note";
  const isVideo = item.mediaType === "video";
  const isPhoto = item.mediaType === "photo";
  const url = mediaUrl(item.objectPath);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      {isPhoto && (
        <Image
          source={{ uri: url }}
          style={styles.cardImage}
          contentFit="cover"
          transition={200}
        />
      )}

      {isVideo && (
        <View style={[styles.cardImage, styles.videoPlaceholder, { backgroundColor: colors.muted }]}>
          <View
            style={[
              styles.playBtn,
              { backgroundColor: colors.primary },
            ]}
          >
            <Feather name="play" size={24} color={colors.primaryForeground} />
          </View>
        </View>
      )}

      {isVoice && (
        <View
          style={[
            styles.voiceCard,
            {
              backgroundColor: colors.muted,
              borderRadius: colors.radius,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.voiceIcon,
              { backgroundColor: colors.primary },
            ]}
          >
            <Feather name="mic" size={20} color={colors.primaryForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.voiceLabel,
                { color: colors.foreground, fontFamily: "Outfit_500Medium" },
              ]}
            >
              Voice Note
            </Text>
            {item.durationSeconds != null && (
              <Text
                style={[
                  styles.voiceDuration,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Outfit_400Regular",
                  },
                ]}
              >
                {item.durationSeconds}s
              </Text>
            )}
          </View>
        </View>
      )}

      <View style={styles.cardMeta}>
        <Text
          style={[
            styles.cardName,
            { color: colors.foreground, fontFamily: "Outfit_500Medium" },
          ]}
          numberOfLines={1}
        >
          {item.uploaderDisplayName ?? "Guest"}
        </Text>
        <Text
          style={[
            styles.cardTime,
            { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
          ]}
        >
          {formatTime(item.createdAt)}
        </Text>
      </View>
    </View>
  );
}

export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { eventId, guestToken, eventTitle, eventStatus } = useEvent();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useListEventMedia(
    eventId ?? "",
    {
      request: { headers: { "X-Guest-Token": guestToken ?? "" } },
      query: {
        enabled: !!eventId,
        refetchInterval: 10000,
        refetchIntervalInBackground: false,
      },
    }
  );

  const media = data?.media ?? [];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.center}>
          <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
          <Text
            style={[
              styles.emptyText,
              { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
            ]}
          >
            Could not load media
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: colors.border }]}
            onPress={() => refetch()}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.retryText,
                { color: colors.primary, fontFamily: "Outfit_500Medium" },
              ]}
            >
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <Feather name="image" size={48} color={colors.border} />
        <Text
          style={[
            styles.emptyTitle,
            { color: colors.foreground, fontFamily: "Outfit_600SemiBold" },
          ]}
        >
          No moments yet
        </Text>
        <Text
          style={[
            styles.emptyText,
            { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
          ]}
        >
          Be the first to share a photo, video, or voice note!
        </Text>
      </View>
    );
  };

  return (
    <View
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <View>
          <Text
            style={[
              styles.eventTitle,
              { color: colors.foreground, fontFamily: "Outfit_700Bold" },
            ]}
            numberOfLines={1}
          >
            {eventTitle ?? "Event Feed"}
          </Text>
          {eventStatus && (
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      eventStatus === "live"
                        ? "#22c55e"
                        : eventStatus === "ended"
                        ? colors.mutedForeground
                        : colors.border,
                  },
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Outfit_400Regular",
                  },
                ]}
              >
                {eventStatus === "live"
                  ? "Live"
                  : eventStatus === "ended"
                  ? "Event ended"
                  : "Upcoming"}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.mediaCount}>
          <Text
            style={[
              styles.countText,
              { color: colors.mutedForeground, fontFamily: "Outfit_500Medium" },
            ]}
          >
            {media.length} {media.length === 1 ? "moment" : "moments"}
          </Text>
        </View>
      </View>

      <FlatList
        data={media}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: botPad + 90 },
          media.length === 0 && styles.emptyList,
        ]}
        columnWrapperStyle={styles.row}
        scrollEnabled={!!media.length}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={renderEmpty}
        renderItem={({ item }) => <MediaCard item={item} colors={colors} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  eventTitle: { fontSize: 22, maxWidth: 220 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13 },
  mediaCount: { alignItems: "flex-end" },
  countText: { fontSize: 13 },

  list: { padding: 12, gap: 0 },
  emptyList: { flex: 1 },
  row: { gap: 10, marginBottom: 10 },

  card: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    minHeight: 180,
  },
  cardImage: { width: "100%", height: 160 },
  videoPlaceholder: { alignItems: "center", justifyContent: "center" },
  playBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    margin: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  voiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceLabel: { fontSize: 15 },
  voiceDuration: { fontSize: 13, marginTop: 2 },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cardName: { fontSize: 13, flex: 1, marginRight: 4 },
  cardTime: { fontSize: 12 },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyTitle: { fontSize: 18, textAlign: "center" },
  emptyText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  retryText: { fontSize: 15 },
});
