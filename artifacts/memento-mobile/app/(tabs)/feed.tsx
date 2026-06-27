import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { ResizeMode, Video } from "expo-av";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
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
import { MediaItem, useListEventMedia } from "@workspace/api-client-react";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;

function mediaUrl(objectPath: string) {
  return `https://${DOMAIN}/api/storage/objects/${objectPath}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function VoiceNotePlayer({
  uri,
  colors,
}: {
  uri: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const togglePlay = async () => {
    if (isLoading) return;
    if (!sound) {
      setIsLoading(true);
      try {
        const { sound: s } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true }
        );
        setSound(s);
        setIsPlaying(true);
        s.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
          }
        });
      } catch {
        /* ignore */
      } finally {
        setIsLoading(false);
      }
    } else if (isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  };

  return (
    <View
      style={[
        vpStyles.container,
        { backgroundColor: colors.muted, borderRadius: colors.radius },
      ]}
    >
      <TouchableOpacity
        style={[vpStyles.btn, { backgroundColor: colors.primary }]}
        onPress={togglePlay}
        activeOpacity={0.8}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Feather name={isPlaying ? "pause" : "play"} size={20} color="#fff" />
        )}
      </TouchableOpacity>
      <View style={vpStyles.waveform}>
        {Array.from({ length: 20 }).map((_, i) => (
          <View
            key={i}
            style={[
              vpStyles.bar,
              {
                height: 8 + (i % 5) * 6,
                backgroundColor: isPlaying
                  ? colors.primary
                  : colors.border,
              },
            ]}
          />
        ))}
      </View>
      <Text
        style={[
          vpStyles.label,
          { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
        ]}
      >
        Voice Note
      </Text>
    </View>
  );
}

const vpStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    flex: 1,
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  waveform: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 36,
  },
  bar: { width: 3, borderRadius: 2 },
  label: { fontSize: 12 },
});

function FullscreenViewer({
  item,
  visible,
  onClose,
  colors,
}: {
  item: MediaItem | null;
  visible: boolean;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  if (!item) return null;
  const url = mediaUrl(item.objectPath);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={fsStyles.backdrop}>
        <TouchableOpacity
          style={fsStyles.closeBtn}
          onPress={onClose}
          activeOpacity={0.8}
        >
          <View style={fsStyles.closeBg}>
            <Feather name="x" size={22} color="#fff" />
          </View>
        </TouchableOpacity>

        {item.mediaType === "photo" && (
          <Image
            source={{ uri: url }}
            style={fsStyles.fullMedia}
            contentFit="contain"
          />
        )}

        {item.mediaType === "video" && (
          <Video
            source={{ uri: url }}
            style={fsStyles.fullMedia}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
            shouldPlay
          />
        )}

        {item.mediaType === "voice_note" && (
          <View style={fsStyles.voiceContainer}>
            <View
              style={[
                fsStyles.voiceIcon,
                { backgroundColor: colors.primary },
              ]}
            >
              <Feather name="mic" size={40} color="#fff" />
            </View>
            <Text
              style={[
                fsStyles.voiceTitle,
                { fontFamily: "Outfit_600SemiBold" },
              ]}
            >
              Voice Note
            </Text>
            {item.durationSeconds != null && (
              <Text
                style={[
                  fsStyles.voiceDur,
                  { fontFamily: "Outfit_400Regular" },
                ]}
              >
                {item.durationSeconds}s
              </Text>
            )}
            <VoiceNotePlayer uri={url} colors={colors} />
          </View>
        )}

        <View style={fsStyles.meta}>
          <Text style={[fsStyles.metaName, { fontFamily: "Outfit_500Medium" }]}>
            {item.uploaderDisplayName ?? "Guest"}
          </Text>
          <Text
            style={[fsStyles.metaTime, { fontFamily: "Outfit_400Regular" }]}
          >
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const fsStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: { position: "absolute", top: 56, right: 20, zIndex: 10 },
  closeBg: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  fullMedia: { width: "100%", height: "75%" },
  voiceContainer: { alignItems: "center", gap: 16, paddingHorizontal: 32, width: "100%" },
  voiceIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceTitle: { color: "#fff", fontSize: 20 },
  voiceDur: { color: "rgba(255,255,255,0.6)", fontSize: 15 },
  meta: {
    position: "absolute",
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 4,
  },
  metaName: { color: "#fff", fontSize: 16 },
  metaTime: { color: "rgba(255,255,255,0.6)", fontSize: 13 },
});

function MediaCard({
  item,
  colors,
  onPress,
}: {
  item: MediaItem;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const isVoice = item.mediaType === "voice_note";
  const isVideo = item.mediaType === "video";
  const isPhoto = item.mediaType === "photo";
  const url = mediaUrl(item.objectPath);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
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
        <View
          style={[
            styles.cardImage,
            styles.videoPlaceholder,
            { backgroundColor: colors.muted },
          ]}
        >
          <View style={[styles.playBtn, { backgroundColor: colors.primary }]}>
            <Feather name="play" size={22} color={colors.primaryForeground} />
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
          <View style={[styles.voiceIcon, { backgroundColor: colors.primary }]}>
            <Feather name="mic" size={18} color={colors.primaryForeground} />
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
                {item.durationSeconds}s · tap to play
              </Text>
            )}
          </View>
          <Feather name="play-circle" size={20} color={colors.primary} />
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
    </TouchableOpacity>
  );
}

export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { eventId, guestToken, eventTitle, eventStatus } = useEvent();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);

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

  const openViewer = (item: MediaItem) => {
    setSelectedItem(item);
    setViewerVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

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
              {
                color: colors.mutedForeground,
                fontFamily: "Outfit_400Regular",
              },
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
    <View style={[styles.root, { backgroundColor: colors.background }]}>
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
        <View style={{ flex: 1 }}>
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
        <Text
          style={[
            styles.countText,
            { color: colors.mutedForeground, fontFamily: "Outfit_500Medium" },
          ]}
        >
          {media.length} {media.length === 1 ? "moment" : "moments"}
        </Text>
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
        renderItem={({ item }) => (
          <MediaCard
            item={item}
            colors={colors}
            onPress={() => openViewer(item)}
          />
        )}
      />

      <FullscreenViewer
        item={selectedItem}
        visible={viewerVisible}
        onClose={() => setViewerVisible(false)}
        colors={colors}
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
  eventTitle: { fontSize: 22 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13 },
  countText: { fontSize: 13 },

  list: { padding: 12 },
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
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    margin: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 60,
  },
  voiceIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceLabel: { fontSize: 14 },
  voiceDuration: { fontSize: 12, marginTop: 2 },
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
