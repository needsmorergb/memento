import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  useFonts,
} from "@expo-google-fonts/outfit";
import { setBaseUrl } from "@workspace/api-client-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EventProvider } from "@/context/EventContext";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
if (DOMAIN) {
  setBaseUrl(`https://${DOMAIN}`);
}

SplashScreen.preventAutoHideAsync();

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 30_000 },
  },
});

function extractShareToken(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const joinIdx = parts.indexOf("join");
    if (joinIdx >= 0 && parts[joinIdx + 1]) return parts[joinIdx + 1];
    const tokenIdx = parts.indexOf("token");
    if (tokenIdx >= 0 && parts[tokenIdx + 1]) return parts[tokenIdx + 1];
    const t = parsed.searchParams.get("token") ?? parsed.searchParams.get("t");
    if (t) return t;
    return null;
  } catch {
    return null;
  }
}

function DeepLinkHandler() {
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      const token = extractShareToken(url);
      if (token) {
        router.push({ pathname: "/join", params: { prefillToken: token } });
      }
    });

    const sub = Linking.addEventListener("url", ({ url }) => {
      const token = extractShareToken(url);
      if (token) {
        router.push({ pathname: "/join", params: { prefillToken: token } });
      }
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const tapSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<
          string,
          unknown
        >;
        if (data?.type === "video_ready") {
          router.push("/(tabs)/event");
        } else if (data?.videoUrl && typeof data.videoUrl === "string") {
          router.push({
            pathname: "/video",
            params: {
              url: data.videoUrl as string,
              title: (data.eventTitle as string) ?? "Event Video",
            },
          });
        }
      }
    );

    return () => tapSub.remove();
  }, []);

  return null;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="join" />
      <Stack.Screen name="video" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <EventProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <DeepLinkHandler />
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </EventProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
