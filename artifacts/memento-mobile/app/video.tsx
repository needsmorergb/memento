import { Feather } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef } from "react";
import {
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function VideoScreen() {
  const { url, title, date } = useLocalSearchParams<{
    url: string;
    title: string;
    date?: string;
  }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const videoRef = useRef<Video>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  const formattedDate = date
    ? new Date(date).toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const handleShare = async () => {
    if (!url) return;
    try {
      await Share.share({
        message: title
          ? `Watch the highlight video from "${title}": ${url}`
          : `Watch the highlight video: ${url}`,
        url,
        title: title ?? "Highlight Video",
      });
    } catch {
      // User cancelled share
    }
  };

  const handleUpgrade = () => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    const upgradeUrl = domain
      ? `https://${domain}/upgrade`
      : "https://memento.app/upgrade";
    Linking.openURL(upgradeUrl);
  };

  if (!url) {
    return (
      <View
        style={[
          styles.root,
          { backgroundColor: colors.background, paddingTop: topPad },
        ]}
      >
        <TouchableOpacity
          style={[styles.backBtn, { top: topPad + 8 }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Feather name="x" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.center}>
          <Feather name="film" size={48} color={colors.mutedForeground} />
          <Text
            style={[
              styles.noVideoText,
              { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
            ]}
          >
            Video URL not available
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: "#000" }]}>
      <Video
        ref={videoRef}
        source={{ uri: url }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.CONTAIN}
        useNativeControls
        shouldPlay
      />

      <TouchableOpacity
        style={[styles.backBtn, { top: topPad + 8 }]}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <View style={styles.iconBubble}>
          <Feather name="chevron-left" size={22} color="#fff" />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.shareBtn, { top: topPad + 8 }]}
        onPress={handleShare}
        activeOpacity={0.7}
      >
        <View style={styles.iconBubble}>
          <Feather name="share" size={18} color="#fff" />
        </View>
      </TouchableOpacity>

      {(title || formattedDate) && (
        <View style={[styles.titleBar, { top: topPad }]}>
          {title ? (
            <Text
              style={[styles.titleText, { fontFamily: "Outfit_600SemiBold" }]}
              numberOfLines={1}
            >
              {title}
            </Text>
          ) : null}
          {formattedDate ? (
            <Text
              style={[styles.dateText, { fontFamily: "Outfit_400Regular" }]}
              numberOfLines={1}
            >
              {formattedDate}
            </Text>
          ) : null}
        </View>
      )}

      <View
        style={[
          styles.upgradeBanner,
          { bottom: botPad + 8, backgroundColor: "rgba(0,0,0,0.65)" },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.upgradeTitle,
              { fontFamily: "Outfit_600SemiBold" },
            ]}
          >
            Love your highlight video?
          </Text>
          <Text
            style={[
              styles.upgradeBody,
              { fontFamily: "Outfit_400Regular" },
            ]}
          >
            Upgrade to Pro for HD quality, no watermarks, and lifetime storage.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.upgradeBtn}
          onPress={handleUpgrade}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.upgradeBtnText, { fontFamily: "Outfit_600SemiBold" }]}
          >
            Upgrade
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backBtn: { position: "absolute", left: 16, zIndex: 10 },
  shareBtn: { position: "absolute", right: 16, zIndex: 10 },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  titleBar: {
    position: "absolute",
    left: 60,
    right: 60,
    alignItems: "center",
    zIndex: 10,
    gap: 2,
  },
  titleText: { color: "#fff", fontSize: 16, textAlign: "center" },
  dateText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    textAlign: "center",
  },
  upgradeBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    zIndex: 10,
  },
  upgradeTitle: { color: "#fff", fontSize: 14, marginBottom: 2 },
  upgradeBody: { color: "rgba(255,255,255,0.75)", fontSize: 12, lineHeight: 16 },
  upgradeBtn: {
    backgroundColor: "#b05c3c",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  upgradeBtnText: { color: "#fff", fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  noVideoText: { fontSize: 16, textAlign: "center" },
});
