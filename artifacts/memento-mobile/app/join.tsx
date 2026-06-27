import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
  updateGuest,
  useJoinEvent,
} from "@workspace/api-client-react";

type Tab = "qr" | "code";

function extractShareToken(raw: string): string | null {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const joinIdx = parts.indexOf("join");
    if (joinIdx >= 0 && parts[joinIdx + 1]) return parts[joinIdx + 1];
    const tokenIdx = parts.indexOf("token");
    if (tokenIdx >= 0 && parts[tokenIdx + 1]) return parts[tokenIdx + 1];
    const q = url.searchParams.get("token") ?? url.searchParams.get("t");
    if (q) return q;
    return parts[parts.length - 1] || null;
  } catch {
    return trimmed || null;
  }
}

async function registerPushTokenIfAllowed(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    let finalStatus = status;
    if (status !== "granted") {
      const { status: s } = await Notifications.requestPermissionsAsync();
      finalStatus = s;
    }
    if (finalStatus !== "granted") return null;
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    return null;
  }
}

export default function JoinScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { setEvent } = useEvent();
  const params = useLocalSearchParams<{ prefillToken?: string }>();

  const [tab, setTab] = useState<Tab>(params.prefillToken ? "code" : "qr");
  const [manualCode, setManualCode] = useState(params.prefillToken ?? "");
  const [guestName, setGuestName] = useState("");
  const [scanned, setScanned] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  const [permission, requestPermission] = useCameraPermissions();

  const joinMutation = useJoinEvent();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (params.prefillToken) {
      setManualCode(params.prefillToken);
      setTab("code");
    }
  }, [params.prefillToken]);

  const doJoin = (shareToken: string, name: string) => {
    if (!name.trim()) {
      Alert.alert("Name required", "Please enter your name to join.");
      return;
    }
    joinMutation.mutate(
      { data: { shareToken: shareToken.trim(), displayName: name.trim() } },
      {
        onSuccess: async (res) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

          const isHost =
            !!res.event.hostName &&
            res.guest.displayName.toLowerCase().trim() ===
              res.event.hostName.toLowerCase().trim();

          setEvent({
            eventId: res.event.id,
            shareToken,
            guestToken: res.guest.guestToken,
            guestId: res.guest.id,
            guestName: res.guest.displayName,
            eventTitle: res.event.title,
            eventStatus: res.event.status,
            hostId: null,
            isHost,
            eventHostName: res.event.hostName ?? null,
          });

          const pushToken = await registerPushTokenIfAllowed();
          if (pushToken && res.guest.guestToken) {
            updateGuest(
              { pushToken },
              { headers: { "X-Guest-Token": res.guest.guestToken } }
            ).catch(() => {});
          }

          router.replace("/(tabs)/feed");
        },
        onError: (err: unknown) => {
          const msg =
            err instanceof Error ? err.message : "Could not join event.";
          Alert.alert("Join failed", msg);
          setScanned(false);
          setPendingToken(null);
        },
      }
    );
  };

  const handleBarcode = ({ data }: { data: string }) => {
    if (scanned || joinMutation.isPending) return;
    const token = extractShareToken(data);
    if (!token) return;
    setScanned(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingToken(token);
    setTimeout(() => nameInputRef.current?.focus(), 100);
  };

  const handleManualJoin = () => {
    const token = extractShareToken(manualCode);
    if (!token) {
      Alert.alert("Invalid code", "Please enter a valid share code or link.");
      return;
    }
    doJoin(token, guestName);
  };

  const handleQRNameJoin = () => {
    if (pendingToken) doJoin(pendingToken, guestName);
  };

  const renderQRTab = () => {
    if (!permission) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (!permission.granted) {
      return (
        <View style={styles.center}>
          <Feather name="camera-off" size={48} color={colors.mutedForeground} />
          <Text
            style={[
              styles.permText,
              { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
            ]}
          >
            Camera access is needed to scan QR codes.
          </Text>
          <TouchableOpacity
            style={[styles.permBtn, { backgroundColor: colors.primary }]}
            onPress={requestPermission}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.permBtnText,
                {
                  color: colors.primaryForeground,
                  fontFamily: "Outfit_600SemiBold",
                },
              ]}
            >
              Allow Camera
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!pendingToken) {
      return (
        <View style={styles.qrContainer}>
          <View style={styles.scannerWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              onBarcodeScanned={handleBarcode}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            />
            <View style={styles.overlay}>
              <View
                style={[styles.scanFrame, { borderColor: colors.primary }]}
              />
            </View>
          </View>
          <Text
            style={[
              styles.scanHint,
              { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
            ]}
          >
            Point your camera at the event QR code
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.nameSection}>
        <View
          style={[styles.successBadge, { backgroundColor: colors.muted }]}
        >
          <Feather name="check-circle" size={28} color={colors.primary} />
          <Text
            style={[
              styles.successText,
              { color: colors.foreground, fontFamily: "Outfit_600SemiBold" },
            ]}
          >
            QR code scanned!
          </Text>
        </View>
        <Text
          style={[
            styles.label,
            { color: colors.foreground, fontFamily: "Outfit_600SemiBold" },
          ]}
        >
          Your name
        </Text>
        <TextInput
          ref={nameInputRef}
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
              fontFamily: "Outfit_400Regular",
            },
          ]}
          placeholder="e.g. Alex"
          placeholderTextColor={colors.mutedForeground}
          value={guestName}
          onChangeText={setGuestName}
          returnKeyType="done"
          onSubmitEditing={handleQRNameJoin}
          autoFocus
        />
        <TouchableOpacity
          style={[
            styles.joinBtn,
            {
              backgroundColor: colors.primary,
              opacity: joinMutation.isPending ? 0.6 : 1,
            },
          ]}
          onPress={handleQRNameJoin}
          disabled={joinMutation.isPending}
          activeOpacity={0.8}
        >
          {joinMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text
              style={[
                styles.joinBtnText,
                {
                  color: colors.primaryForeground,
                  fontFamily: "Outfit_600SemiBold",
                },
              ]}
            >
              Join Event
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setPendingToken(null);
            setScanned(false);
          }}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.rescanText,
              {
                color: colors.mutedForeground,
                fontFamily: "Outfit_400Regular",
              },
            ]}
          >
            Scan again
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderCodeTab = () => (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.codeContainer}
    >
      <ScrollView
        contentContainerStyle={styles.codeScroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={[
            styles.label,
            { color: colors.foreground, fontFamily: "Outfit_600SemiBold" },
          ]}
        >
          Share link or code
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
              fontFamily: "Outfit_400Regular",
            },
          ]}
          placeholder="Paste link or enter code"
          placeholderTextColor={colors.mutedForeground}
          value={manualCode}
          onChangeText={setManualCode}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text
          style={[
            styles.label,
            {
              color: colors.foreground,
              fontFamily: "Outfit_600SemiBold",
              marginTop: 8,
            },
          ]}
        >
          Your name
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
              fontFamily: "Outfit_400Regular",
            },
          ]}
          placeholder="e.g. Alex"
          placeholderTextColor={colors.mutedForeground}
          value={guestName}
          onChangeText={setGuestName}
          returnKeyType="done"
          onSubmitEditing={handleManualJoin}
        />
        <TouchableOpacity
          style={[
            styles.joinBtn,
            {
              backgroundColor: colors.primary,
              opacity: joinMutation.isPending ? 0.6 : 1,
            },
          ]}
          onPress={handleManualJoin}
          disabled={joinMutation.isPending}
          activeOpacity={0.8}
        >
          {joinMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text
              style={[
                styles.joinBtnText,
                {
                  color: colors.primaryForeground,
                  fontFamily: "Outfit_600SemiBold",
                },
              ]}
            >
              Join Event
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.background, paddingTop: topPad },
      ]}
    >
      <View style={styles.header}>
        <Text
          style={[
            styles.heading,
            { color: colors.foreground, fontFamily: "Outfit_700Bold" },
          ]}
        >
          Join Event
        </Text>
      </View>

      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {(["qr", "code"] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[
              styles.tabBtn,
              tab === t && {
                borderBottomColor: colors.primary,
                borderBottomWidth: 2,
              },
            ]}
            onPress={() => setTab(t)}
            activeOpacity={0.8}
          >
            <Feather
              name={t === "qr" ? "maximize" : "edit-3"}
              size={16}
              color={tab === t ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[
                styles.tabLabel,
                {
                  color:
                    tab === t ? colors.primary : colors.mutedForeground,
                  fontFamily:
                    tab === t ? "Outfit_600SemiBold" : "Outfit_400Regular",
                },
              ]}
            >
              {t === "qr" ? "Scan QR" : "Enter Code"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.tabContent, { paddingBottom: botPad }]}>
        {tab === "qr" ? renderQRTab() : renderCodeTab()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  heading: { fontSize: 28 },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 24,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
  },
  tabLabel: { fontSize: 15 },
  tabContent: { flex: 1 },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  permText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  permBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  permBtnText: { fontSize: 16 },

  qrContainer: { flex: 1, alignItems: "center" },
  scannerWrap: {
    width: "100%",
    flex: 1,
    maxHeight: 340,
    overflow: "hidden",
    position: "relative",
    marginTop: 16,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  scanFrame: {
    width: 220,
    height: 220,
    borderWidth: 3,
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  scanHint: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 20,
    paddingHorizontal: 24,
  },

  nameSection: { flex: 1, padding: 24, gap: 12, width: "100%" },
  successBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  successText: { fontSize: 16 },

  codeContainer: { flex: 1 },
  codeScroll: { padding: 24, gap: 8 },

  label: { fontSize: 15, marginBottom: 4 },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 4,
  },
  joinBtn: {
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  joinBtnText: { fontSize: 17 },
  rescanText: { fontSize: 15, textAlign: "center", marginTop: 8 },
});
