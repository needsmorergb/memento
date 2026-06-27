import { Feather } from "@expo/vector-icons";
import { useAuth, useClerk, useUser } from "@clerk/expo";
import { endEvent } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "@/context/EventContext";
import { useColors } from "@/hooks/useColors";
import {
  useGetEventByToken,
  useGetEventVideoStatusByToken,
  useListEventMedia,
  useGetMySubscription,
  getGetMySubscriptionQueryKey,
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
    updateStatus,
  } = useEvent();

  const { isSignedIn, getToken, signOut } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();

  const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
  const { data: mySub } = useGetMySubscription({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { queryKey: getGetMySubscriptionQueryKey(), enabled: !!isSignedIn } as any,
  });
  const subTier = mySub?.tier ?? "free";
  const tierLabel =
    subTier === "vendor" ? "Vendor" : subTier === "pro" ? "Pro" : "Free";

  function handleManageSubscription() {
    const portalUrl = `https://${DOMAIN}/host`;
    Linking.openURL(portalUrl);
  }

  const [showSignInForm, setShowSignInForm] = React.useState(false);
  const [signInEmail, setSignInEmail] = React.useState("");
  const [signInPassword, setSignInPassword] = React.useState("");
  const [authLoading, setAuthLoading] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [endingEvent, setEndingEvent] = React.useState(false);

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
      if (!seen.has(name)) {
        seen.add(name);
        list.push(name);
      }
    }
    return list;
  }, [mediaData]);

  const { data: eventData, isLoading: eventLoading } = useGetEventByToken(
    shareToken ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !!shareToken, refetchInterval: 15000 } as any }
  );

  const { data: videoStatus } = useGetEventVideoStatusByToken(shareToken ?? "", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { enabled: !!shareToken && eventStatus === "ended", refetchInterval: 20000 } as any,
  });

  const handleClerkSignIn = async () => {
    if (!clerk.client) {
      setAuthError("Authentication service not ready. Please try again.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientAny = clerk.client as any;
      const result = await clientAny.signIn.create({
        identifier: signInEmail.trim(),
        password: signInPassword,
      });
      if (result?.status === "complete") {
        await clerk.setActive({ session: result.createdSessionId });
      }
      setShowSignInForm(false);
      setSignInEmail("");
      setSignInPassword("");
    } catch (e: unknown) {
      setAuthError(
        e instanceof Error
          ? e.message
          : "Sign-in failed. Check your email and password."
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEndEvent = () => {
    if (!eventId) return;

    if (!isSignedIn) {
      setShowSignInForm(true);
      return;
    }

    Alert.alert(
      "End Event",
      "This will close the event and start generating the highlight video. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End & Generate",
          style: "destructive",
          onPress: async () => {
            if (!eventId) return;
            setEndingEvent(true);
            try {
              const token = await getToken();
              await endEvent(eventId, {
                headers: { Authorization: `Bearer ${token ?? ""}` },
              });
              updateStatus("ended");
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
              Alert.alert(
                "Event ended!",
                "Your highlight video is being compiled. We'll notify you when it's ready."
              );
            } catch (e) {
              const msg =
                e instanceof Error ? e.message : "Could not end event";
              Alert.alert("Error", msg);
            } finally {
              setEndingEvent(false);
            }
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

  const hostEmail = user?.emailAddresses?.[0]?.emailAddress;

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
        keyboardShouldPersistTaps="handled"
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

        {isHost && (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: isSignedIn ? "#bbf7d0" : colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <View
                style={[
                  styles.infoIconWrap,
                  {
                    backgroundColor: isSignedIn
                      ? "#dcfce7"
                      : colors.primary + "15",
                  },
                ]}
              >
                <Feather
                  name={isSignedIn ? "check-circle" : "lock"}
                  size={16}
                  color={isSignedIn ? "#16a34a" : colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.infoLabel,
                    {
                      color: colors.mutedForeground,
                      fontFamily: "Outfit_400Regular",
                    },
                  ]}
                >
                  Host Account
                </Text>
                <Text
                  style={[
                    styles.infoValue,
                    {
                      color: isSignedIn ? "#15803d" : colors.foreground,
                      fontFamily: "Outfit_500Medium",
                    },
                  ]}
                >
                  {isSignedIn
                    ? hostEmail ?? "Signed in"
                    : "Sign in to manage this event"}
                </Text>
              </View>
              {isSignedIn && (
                <TouchableOpacity
                  onPress={() => signOut()}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text
                    style={[
                      styles.linkText,
                      { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
                    ]}
                  >
                    Sign out
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {!isSignedIn && (
              <>
                <TouchableOpacity
                  style={[styles.signInToggle]}
                  onPress={() => setShowSignInForm((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.signInToggleText,
                      { color: colors.primary, fontFamily: "Outfit_500Medium" },
                    ]}
                  >
                    {showSignInForm ? "Hide sign-in form" : "Sign in as host →"}
                  </Text>
                </TouchableOpacity>

                {showSignInForm && (
                  <View style={[styles.signInForm, { borderTopColor: colors.border }]}>
                    {authError && (
                      <View
                        style={[
                          styles.authErrorBox,
                          { backgroundColor: colors.destructive + "15" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.authErrorText,
                            {
                              color: colors.destructive,
                              fontFamily: "Outfit_400Regular",
                            },
                          ]}
                        >
                          {authError}
                        </Text>
                      </View>
                    )}
                    <TextInput
                      style={[
                        styles.input,
                        {
                          borderColor: colors.border,
                          color: colors.foreground,
                          backgroundColor: colors.background,
                          borderRadius: colors.radius,
                          fontFamily: "Outfit_400Regular",
                        },
                      ]}
                      placeholder="Email"
                      placeholderTextColor={colors.mutedForeground}
                      value={signInEmail}
                      onChangeText={setSignInEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                    />
                    <TextInput
                      style={[
                        styles.input,
                        {
                          borderColor: colors.border,
                          color: colors.foreground,
                          backgroundColor: colors.background,
                          borderRadius: colors.radius,
                          fontFamily: "Outfit_400Regular",
                        },
                      ]}
                      placeholder="Password"
                      placeholderTextColor={colors.mutedForeground}
                      value={signInPassword}
                      onChangeText={setSignInPassword}
                      secureTextEntry
                      autoComplete="password"
                    />
                    <TouchableOpacity
                      style={[
                        styles.signInBtn,
                        {
                          backgroundColor: colors.primary,
                          borderRadius: colors.radius,
                          opacity: authLoading ? 0.6 : 1,
                        },
                      ]}
                      onPress={handleClerkSignIn}
                      disabled={authLoading}
                      activeOpacity={0.8}
                    >
                      {authLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text
                          style={[
                            styles.signInBtnText,
                            { fontFamily: "Outfit_600SemiBold" },
                          ]}
                        >
                          Sign In
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
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
                style={[styles.watchBtn, { backgroundColor: "#16a34a" }]}
                onPress={() => {
                  if (videoStatus.videoUrl) {
                    router.push({
                      pathname: "/video",
                      params: {
                        url: videoStatus.videoUrl,
                        title: eventTitle ?? "Highlight Video",
                        date: event?.eventDate ?? "",
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
                  { color: colors.destructive, fontFamily: "Outfit_400Regular" },
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
              style={[styles.infoRow, { borderBottomColor: colors.border }]}
            >
              <View
                style={[styles.infoIconWrap, { backgroundColor: colors.muted }]}
              >
                <Feather name="users" size={16} color={colors.primary} />
              </View>
              <Text
                style={[
                  styles.infoValue,
                  { color: colors.foreground, fontFamily: "Outfit_600SemiBold" },
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
                    { color: colors.foreground, fontFamily: "Outfit_400Regular" },
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
            {!isSignedIn && (
              <Text
                style={[
                  styles.hostNote,
                  { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
                ]}
              >
                Sign in above to unlock host controls.
              </Text>
            )}
            <TouchableOpacity
              style={[
                styles.endBtn,
                {
                  backgroundColor: isSignedIn
                    ? colors.destructive
                    : colors.muted,
                  borderRadius: colors.radius,
                  opacity: endingEvent ? 0.6 : 1,
                },
              ]}
              onPress={handleEndEvent}
              disabled={endingEvent}
              activeOpacity={0.8}
            >
              {endingEvent ? (
                <ActivityIndicator color={isSignedIn ? "#fff" : colors.mutedForeground} />
              ) : (
                <>
                  <Feather
                    name={isSignedIn ? "stop-circle" : "lock"}
                    size={18}
                    color={isSignedIn ? "#fff" : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.endBtnText,
                      {
                        color: isSignedIn ? "#fff" : colors.mutedForeground,
                        fontFamily: "Outfit_600SemiBold",
                      },
                    ]}
                  >
                    {isSignedIn
                      ? "End Event & Generate Video"
                      : "Sign In to End Event"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {isSignedIn && (
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
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <View
                style={[styles.infoIconWrap, { backgroundColor: colors.muted }]}
              >
                <Feather name="star" size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.infoLabel,
                    {
                      color: colors.mutedForeground,
                      fontFamily: "Outfit_400Regular",
                    },
                  ]}
                >
                  Subscription
                </Text>
                <Text
                  style={[
                    styles.infoValue,
                    { color: colors.foreground, fontFamily: "Outfit_500Medium" },
                  ]}
                >
                  {tierLabel} Plan
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[
                styles.signInBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: 0,
                  borderBottomLeftRadius: colors.radius,
                  borderBottomRightRadius: colors.radius,
                },
              ]}
              onPress={handleManageSubscription}
              activeOpacity={0.8}
            >
              <Text
                style={[styles.signInBtnText, { fontFamily: "Outfit_600SemiBold" }]}
              >
                {subTier === "free" ? "Upgrade to Pro →" : "Manage Subscription →"}
              </Text>
            </TouchableOpacity>
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

  card: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
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
  linkText: { fontSize: 13 },

  signInToggle: { paddingHorizontal: 16, paddingVertical: 12 },
  signInToggleText: { fontSize: 14 },
  signInForm: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  authErrorBox: { borderRadius: 8, padding: 10 },
  authErrorText: { fontSize: 13, lineHeight: 18 },
  input: {
    height: 46,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  signInBtn: {
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  signInBtnText: { color: "#fff", fontSize: 15 },

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
  endBtnText: { fontSize: 16 },
  hostNote: { fontSize: 12 },

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
