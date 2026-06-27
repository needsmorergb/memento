import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "@/context/EventContext";
import { useColors } from "@/hooks/useColors";
import {
  useEndEvent,
  useGetEventByToken,
  useGetEventVideoStatusByToken,
  useListEventMedia,
} from "@workspace/api-client-react";

function InfoRow({
  icon,
  label,
  value,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIconWrap, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.infoLabel,
            { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
          ]}
        >
          {label}
        </Text>
        <Text
          style={[
            styles.infoValue,
            { color: colors.foreground, fontFamily: "Outfit_500Medium" },
          ]}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

export default function EventScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    eventId,
    shareToken,
    guestToken,
    guestName,
    eventTitle,
    eventStatus,
    isHost,
    eventHostName,
    clearEvent,
  } = useEvent();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: mediaData } = useListEventMedia(eventId ?? "", {
    request: { headers: { "X-Guest-Token": guestToken ?? "" } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { enabled: !!eventId && isHost, refetchInterval: 20000 } as any,
  });

  const guestRoster = React.useMemo(() => {
    if (!mediaData?.media) return [];
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of mediaData.media) {
      const name = item.uploaderDisplayName ?? "Guest";
      if (!seen.has(name)) { seen.add(name); list.push(name); }
    }
    return list;
  }, [mediaData]);

  const { data: eventData, isLoading: eventLoading } = useGetEventByToken(
    shareToken ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !!shareToken, refetchInterval: 15000 } as any }
  );

  const { data: videoStatus } = useGetEventVideoStatusByToken(
    shareToken ?? "",
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: { enabled: !!shareToken && eventStatus === "ended", refetchInterval: 20000 } as any,
    }
  );

  const endEventMutation = useEndEvent();

  const handleEndEvent = () => {
    Alert.alert(
      "End Event",
      "This will end the event and start generating the highlight video. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End & Generate",
          style: "destructive",
          onPress: () => {
            if (!eventId) return;
            endEventMutation.mutate(
              { eventId },
              {
                onSuccess: () => {
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success
                  );
                  Alert.alert(
                    "Event ended!",
                    "Your highlight video is being compiled. We'll notify you when it's ready."
                  );
                },
                onError: (err) => {
                  const msg =
                    err instanceof Error ? err.message : "Could not end event";
                  if (msg.includes("401") || msg.includes("403")) {
                    Alert.alert(
                      "Sign in required",
                      "Host controls require you to sign in with your account. Please use the web app to end the event.",
                      [{ text: "OK" }]
                    );
                  } else {
                    Alert.alert("Error", msg);
                  }
                },
              }
            );
          },
        },
      ]
    );
  };

  const handleLeave = () => {
    Alert.alert("Leave Event", "Remove this event from your device?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () => {
          clearEvent();
          router.replace("/onboarding");
        },
      },
    ]);
  };

  const event = eventData;
  const guestCount = event?.guestCount;
  const eventDate = event?.eventDate
    ? new Date(event.eventDate).toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.background, paddingTop: topPad },
      ]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: botPad + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerSection}>
          <Text
            style={[
              styles.eventTitle,
              { color: colors.foreground, fontFamily: "Outfit_700Bold" },
            ]}
            numberOfLines={2}
          >
            {eventTitle ?? "My Event"}
          </Text>
          <View style={styles.pillRow}>
            {eventStatus && (
              <View
                style={[
                  styles.statusPill,
                  {
                    backgroundColor:
                      eventStatus === "live"
                        ? "#dcfce7"
                        : eventStatus === "ended"
                        ? colors.muted
                        : "#fef9c3",
                  },
                ]}
              >
                <View
                  style={[
                    styles.pillDot,
                    {
                      backgroundColor:
                        eventStatus === "live"
                          ? "#16a34a"
                          : eventStatus === "ended"
                          ? colors.mutedForeground
                          : "#ca8a04",
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.pillText,
                    {
                      color:
                        eventStatus === "live"
                          ? "#15803d"
                          : eventStatus === "ended"
                          ? colors.mutedForeground
                          : "#854d0e",
                      fontFamily: "Outfit_500Medium",
                    },
                  ]}
                >
                  {eventStatus === "live"
                    ? "Live"
                    : eventStatus === "ended"
                    ? "Ended"
                    : "Upcoming"}
                </Text>
              </View>
            )}
            {isHost && (
              <View
                style={[
                  styles.hostPill,
                  { backgroundColor: colors.primary + "20" },
                ]}
              >
                <Feather name="star" size={12} color={colors.primary} />
                <Text
                  style={[
                    styles.pillText,
                    { color: colors.primary, fontFamily: "Outfit_600SemiBold" },
                  ]}
                >
                  Host
                </Text>
              </View>
            )}
          </View>
        </View>

        {eventLoading && !event ? (
          <ActivityIndicator
            color={colors.primary}
            style={{ marginVertical: 24 }}
          />
        ) : (
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
            {eventDate && (
              <InfoRow
                icon="calendar"
                label="Date"
                value={eventDate}
                colors={colors}
              />
            )}
            {guestCount != null && (
              <InfoRow
                icon="users"
                label="Guests"
                value={`${guestCount} joined`}
                colors={colors}
              />
            )}
            {eventHostName && (
              <InfoRow
                icon="user-check"
                label="Host"
                value={eventHostName}
                colors={colors}
              />
            )}
            <InfoRow
              icon="user"
              label="You"
              value={guestName ?? "Guest"}
              colors={colors}
            />
          </View>
        )}

        {videoStatus && (
          <View
            style={[
              styles.videoCard,
              {
                backgroundColor:
                  videoStatus.status === "completed" ? "#f0fdf4" : colors.muted,
                borderColor:
                  videoStatus.status === "completed"
                    ? "#bbf7d0"
                    : colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <View style={styles.videoCardHeader}>
              <Feather
                name="film"
                size={20}
                color={
                  videoStatus.status === "completed" ? "#16a34a" : colors.primary
                }
              />
              <Text
                style={[
                  styles.videoCardTitle,
                  {
                    color:
                      videoStatus.status === "completed"
                        ? "#15803d"
                        : colors.foreground,
                    fontFamily: "Outfit_600SemiBold",
                    flex: 1,
                  },
                ]}
              >
                {videoStatus.status === "pending"
                  ? "Video queued…"
                  : videoStatus.status === "processing"
                  ? "Compiling video…"
                  : videoStatus.status === "completed"
                  ? "Highlight video ready!"
                  : "Video generation failed"}
              </Text>
              {(videoStatus.status === "pending" ||
                videoStatus.status === "processing") && (
                <ActivityIndicator size="small" color={colors.primary} />
              )}
            </View>
            {videoStatus.status === "completed" && videoStatus.videoUrl && (
              <TouchableOpacity
                style={[
                  styles.watchBtn,
                  { backgroundColor: "#16a34a" },
                ]}
                onPress={() => {
                  if (videoStatus.videoUrl) {
                    router.push({
                      pathname: "/video",
                      params: {
                        url: videoStatus.videoUrl,
                        title: eventTitle ?? "Highlight Video",
                      },
                    });
                  }
                }}
                activeOpacity={0.8}
              >
                <Feather name="play" size={16} color="#fff" />
                <Text
                  style={[
                    styles.watchBtnText,
                    { fontFamily: "Outfit_600SemiBold" },
                  ]}
                >
                  Watch Video
                </Text>
              </TouchableOpacity>
            )}
            {videoStatus.status === "failed" && videoStatus.errorMessage && (
              <Text
                style={[
                  styles.videoSub,
                  {
                    color: colors.destructive,
                    fontFamily: "Outfit_400Regular",
                  },
                ]}
              >
                {videoStatus.errorMessage}
              </Text>
            )}
          </View>
        )}

        {isHost && guestRoster.length > 0 && (
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
            <View
              style={[
                styles.infoRow,
                { borderBottomColor: colors.border },
              ]}
            >
              <View
                style={[styles.infoIconWrap, { backgroundColor: colors.muted }]}
              >
                <Feather name="users" size={16} color={colors.primary} />
              </View>
              <Text
                style={[
                  styles.infoValue,
                  {
                    color: colors.foreground,
                    fontFamily: "Outfit_600SemiBold",
                  },
                ]}
              >
                Contributors ({guestRoster.length})
              </Text>
            </View>
            {guestRoster.map((name, i) => (
              <View
                key={name}
                style={[
                  styles.infoRow,
                  i === guestRoster.length - 1 && { borderBottomWidth: 0 },
                  { borderBottomColor: colors.border },
                ]}
              >
                <View
                  style={[
                    styles.guestAvatar,
                    { backgroundColor: colors.primary + "22" },
                  ]}
                >
                  <Text
                    style={[
                      styles.guestAvatarText,
                      { color: colors.primary, fontFamily: "Outfit_600SemiBold" },
                    ]}
                  >
                    {name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.infoValue,
                    {
                      color: colors.foreground,
                      fontFamily: "Outfit_400Regular",
                    },
                  ]}
                >
                  {name}
                </Text>
              </View>
            ))}
          </View>
        )}

        {isHost && eventStatus !== "ended" && (
          <View style={styles.hostSection}>
            <Text
              style={[
                styles.sectionLabel,
                { color: colors.foreground, fontFamily: "Outfit_600SemiBold" },
              ]}
            >
              Host Controls
            </Text>
            <TouchableOpacity
              style={[
                styles.endBtn,
                {
                  backgroundColor: colors.destructive,
                  borderRadius: colors.radius,
                  opacity: endEventMutation.isPending ? 0.6 : 1,
                },
              ]}
              onPress={handleEndEvent}
              disabled={endEventMutation.isPending}
              activeOpacity={0.8}
            >
              {endEventMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name="stop-circle" size={18} color="#fff" />
                  <Text
                    style={[
                      styles.endBtnText,
                      { fontFamily: "Outfit_600SemiBold" },
                    ]}
                  >
                    End Event & Generate Video
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text
              style={[
                styles.hostNote,
                { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
              ]}
            >
              Host sign-in is required for this action.
            </Text>
          </View>
        )}

        <View style={styles.leaveSection}>
          <TouchableOpacity
            style={[
              styles.leaveBtn,
              { borderColor: colors.border, borderRadius: colors.radius },
            ]}
            onPress={handleLeave}
            activeOpacity={0.7}
          >
            <Feather name="log-out" size={16} color={colors.mutedForeground} />
            <Text
              style={[
                styles.leaveBtnText,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Outfit_500Medium",
                },
              ]}
            >
              Leave Event
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },

  headerSection: { gap: 10 },
  eventTitle: { fontSize: 26, lineHeight: 32 },
  pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  hostPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 13 },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#00000010",
  },
  infoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  infoLabel: { fontSize: 12 },
  infoValue: { fontSize: 15, marginTop: 2 },

  videoCard: { borderWidth: 1, padding: 16, gap: 12 },
  videoCardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  videoCardTitle: { fontSize: 15 },
  videoSub: { fontSize: 13, lineHeight: 18 },
  watchBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 10,
  },
  watchBtnText: { color: "#fff", fontSize: 15 },

  hostSection: { gap: 8 },
  sectionLabel: { fontSize: 16 },
  endBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 54,
    paddingHorizontal: 20,
  },
  endBtnText: { color: "#fff", fontSize: 16 },
  hostNote: { fontSize: 12, textAlign: "center" },

  leaveSection: { marginTop: 4 },
  leaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderWidth: 1,
  },
  leaveBtnText: { fontSize: 15 },
  guestAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  guestAvatarText: { fontSize: 14 },
});
