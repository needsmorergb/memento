import { Feather } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function VideoScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const videoRef = useRef<Video>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

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
              {
                color: colors.mutedForeground,
                fontFamily: "Outfit_400Regular",
              },
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
        <View style={styles.backBtnBg}>
          <Feather name="chevron-left" size={22} color="#fff" />
        </View>
      </TouchableOpacity>
      {title ? (
        <View style={[styles.titleBar, { top: topPad }]}>
          <Text style={[styles.titleText, { fontFamily: "Outfit_600SemiBold" }]}>
            {title}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backBtn: {
    position: "absolute",
    left: 16,
    zIndex: 10,
  },
  backBtnBg: {
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
  },
  titleText: {
    color: "#fff",
    fontSize: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  noVideoText: { fontSize: 16, textAlign: "center" },
});
