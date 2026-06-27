import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";

import { useEvent } from "@/context/EventContext";
import { useColors } from "@/hooks/useColors";

export default function IndexScreen() {
  const { guestToken, isLoaded } = useEvent();
  const colors = useColors();

  if (!isLoaded) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (guestToken) {
    return <Redirect href="/(tabs)/feed" />;
  }

  return <Redirect href="/onboarding" />;
}
