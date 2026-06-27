import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const { width } = Dimensions.get("window");

type Slide = {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
};

const SLIDES: Slide[] = [
  {
    icon: "camera",
    title: "Capture Every Moment",
    subtitle:
      "Share photos, videos, and voice notes with everyone at your event — instantly.",
  },
  {
    icon: "users",
    title: "Join in Seconds",
    subtitle:
      "Scan the QR code at your event to join. No account needed — just your name.",
  },
  {
    icon: "film",
    title: "Same-Day Memories",
    subtitle:
      "A highlight reel is compiled automatically when the event ends.",
  },
];

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<Slide>>(null);

  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    }
  ).current;

  const handleNext = () => {
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1 });
    } else {
      router.push("/join");
    }
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad =
    Platform.OS === "web" ? 34 : Math.max(insets.bottom, 20);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: topPad },
      ]}
    >
      <FlatList<Slide>
        ref={flatListRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View
              style={[
                styles.iconRing,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Feather name={item.icon} size={52} color={colors.primary} />
            </View>
            <Text
              style={[
                styles.title,
                { color: colors.foreground, fontFamily: "Outfit_700Bold" },
              ]}
            >
              {item.title}
            </Text>
            <Text
              style={[
                styles.subtitle,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Outfit_400Regular",
                },
              ]}
            >
              {item.subtitle}
            </Text>
          </View>
        )}
      />

      <View
        style={[styles.footer, { paddingBottom: botPad + 8 }]}
      >
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i === activeIndex ? colors.primary : colors.border,
                  width: i === activeIndex ? 24 : 8,
                },
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleNext}
          activeOpacity={0.82}
        >
          <Text
            style={[
              styles.buttonText,
              {
                color: colors.primaryForeground,
                fontFamily: "Outfit_600SemiBold",
              },
            ]}
          >
            {activeIndex === SLIDES.length - 1 ? "Join an Event" : "Next"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/join")} activeOpacity={0.7}>
          <Text
            style={[
              styles.skipText,
              {
                color: colors.mutedForeground,
                fontFamily: "Outfit_400Regular",
              },
            ]}
          >
            Skip
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 24,
  },
  iconRing: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    textAlign: "center",
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  footer: {
    paddingHorizontal: 28,
    gap: 16,
    alignItems: "center",
  },
  dots: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  button: {
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  buttonText: {
    fontSize: 17,
  },
  skipText: {
    fontSize: 15,
  },
});
