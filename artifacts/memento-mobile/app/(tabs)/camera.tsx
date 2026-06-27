import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "@/context/EventContext";
import { useColors } from "@/hooks/useColors";
import {
  useConfirmMediaUpload,
  useRequestUploadUrl,
} from "@workspace/api-client-react";

type CaptureMode = "photo" | "video" | "voice";

interface UploadState {
  status: "idle" | "uploading" | "success" | "error";
  progress?: string;
  error?: string;
}

async function putFile(
  uploadURL: string,
  uri: string,
  contentType: string
): Promise<void> {
  const response = await globalThis.fetch(uri);
  const blob = await response.blob();
  const putResponse = await globalThis.fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!putResponse.ok) {
    throw new Error(`Upload failed: ${putResponse.status}`);
  }
}

export default function CameraScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { eventId, guestToken, guestName, eventStatus } = useEvent();

  const [mode, setMode] = useState<CaptureMode>("photo");
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
  });
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const requestUploadUrl = useRequestUploadUrl({
    request: { headers: { "X-Guest-Token": guestToken ?? "" } },
  });
  const confirmUpload = useConfirmMediaUpload({
    request: { headers: { "X-Guest-Token": guestToken ?? "" } },
  });

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  const isUploading = uploadState.status === "uploading";

  const doUpload = useCallback(
    async (
      uri: string,
      fileName: string,
      contentType: string,
      mediaType: "photo" | "video" | "voice_note",
      fileSizeBytes?: number,
      durationSeconds?: number
    ) => {
      if (!eventId) {
        Alert.alert("No event", "You are not part of an event.");
        return;
      }
      setUploadState({ status: "uploading", progress: "Preparing upload…" });

      try {
        const urlRes = await new Promise<{ uploadURL: string; objectPath: string }>(
          (resolve, reject) => {
            requestUploadUrl.mutate(
              {
                data: {
                  name: fileName,
                  size: fileSizeBytes ?? 1,
                  contentType,
                },
              },
              { onSuccess: resolve, onError: reject }
            );
          }
        );

        setUploadState({ status: "uploading", progress: "Uploading…" });
        await putFile(urlRes.uploadURL, uri, contentType);

        setUploadState({ status: "uploading", progress: "Saving…" });
        await new Promise<void>((resolve, reject) => {
          confirmUpload.mutate(
            {
              eventId,
              data: {
                objectPath: urlRes.objectPath,
                mediaType,
                fileName,
                fileSizeBytes,
                durationSeconds,
              },
            },
            { onSuccess: () => resolve(), onError: reject }
          );
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setUploadState({ status: "success" });
        setTimeout(() => setUploadState({ status: "idle" }), 2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setUploadState({ status: "error", error: msg });
        Alert.alert("Upload failed", msg);
        setTimeout(() => setUploadState({ status: "idle" }), 3000);
      }
    },
    [eventId, requestUploadUrl, confirmUpload]
  );

  const handlePickPhoto = async () => {
    if (isUploading) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access to upload photos."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const name =
      asset.fileName ?? `photo_${Date.now()}.jpg`;
    await doUpload(
      asset.uri,
      name,
      asset.mimeType ?? "image/jpeg",
      "photo",
      asset.fileSize
    );
  };

  const handleTakePhoto = async () => {
    if (isUploading) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera access to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const name = `photo_${Date.now()}.jpg`;
    await doUpload(
      asset.uri,
      name,
      asset.mimeType ?? "image/jpeg",
      "photo",
      asset.fileSize
    );
  };

  const handlePickVideo = async () => {
    if (isUploading) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access to upload videos."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 120,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const name = asset.fileName ?? `video_${Date.now()}.mp4`;
    await doUpload(
      asset.uri,
      name,
      asset.mimeType ?? "video/mp4",
      "video",
      asset.fileSize,
      asset.duration ? Math.round(asset.duration / 1000) : undefined
    );
  };

  const handleRecordVideo = async () => {
    if (isUploading) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera access to record video.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 120,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const name = `video_${Date.now()}.mp4`;
    await doUpload(
      asset.uri,
      name,
      asset.mimeType ?? "video/mp4",
      "video",
      asset.fileSize,
      asset.duration ? Math.round(asset.duration / 1000) : undefined
    );
  };

  const startVoiceRecording = async () => {
    if (isUploading || recording) return;
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow microphone access to record voice notes.");
      return;
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await rec.startAsync();
    setRecording(rec);
    setRecordingDuration(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    durationIntervalRef.current = setInterval(() => {
      setRecordingDuration((d) => d + 1);
    }, 1000);
  };

  const stopVoiceRecording = async () => {
    if (!recording) return;
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    const dur = recordingDuration;
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    setRecordingDuration(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!uri) {
      Alert.alert("Recording error", "Could not save recording.");
      return;
    }
    await doUpload(
      uri,
      `voice_${Date.now()}.m4a`,
      "audio/m4a",
      "voice_note",
      undefined,
      dur
    );
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const eventEnded = eventStatus === "ended";

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.background, paddingTop: topPad + 12 },
      ]}
    >
      <Text
        style={[
          styles.heading,
          { color: colors.foreground, fontFamily: "Outfit_700Bold" },
        ]}
      >
        Add a Moment
      </Text>

      {eventEnded && (
        <View
          style={[
            styles.endedBanner,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Feather name="info" size={16} color={colors.mutedForeground} />
          <Text
            style={[
              styles.endedText,
              {
                color: colors.mutedForeground,
                fontFamily: "Outfit_400Regular",
              },
            ]}
          >
            This event has ended — new uploads are disabled.
          </Text>
        </View>
      )}

      <View
        style={[
          styles.modeBar,
          { borderColor: colors.border, backgroundColor: colors.muted },
        ]}
      >
        {(["photo", "video", "voice"] as CaptureMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[
              styles.modeBtn,
              mode === m && {
                backgroundColor: colors.background,
                shadowColor: "#000",
                shadowOpacity: 0.06,
                shadowRadius: 4,
                elevation: 2,
              },
            ]}
            onPress={() => setMode(m)}
            activeOpacity={0.7}
          >
            <Feather
              name={
                m === "photo" ? "camera" : m === "video" ? "video" : "mic"
              }
              size={16}
              color={mode === m ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[
                styles.modeBtnText,
                {
                  color: mode === m ? colors.primary : colors.mutedForeground,
                  fontFamily:
                    mode === m ? "Outfit_600SemiBold" : "Outfit_400Regular",
                },
              ]}
            >
              {m === "photo" ? "Photo" : m === "video" ? "Video" : "Voice"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.content, { paddingBottom: botPad + 90 }]}>
        {uploadState.status === "uploading" && (
          <View
            style={[
              styles.uploadBar,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <ActivityIndicator size="small" color={colors.primary} />
            <Text
              style={[
                styles.uploadText,
                {
                  color: colors.foreground,
                  fontFamily: "Outfit_500Medium",
                },
              ]}
            >
              {uploadState.progress}
            </Text>
          </View>
        )}

        {uploadState.status === "success" && (
          <View
            style={[
              styles.uploadBar,
              {
                backgroundColor: "#dcfce7",
                borderColor: "#bbf7d0",
                borderRadius: colors.radius,
              },
            ]}
          >
            <Feather name="check-circle" size={18} color="#16a34a" />
            <Text
              style={[
                styles.uploadText,
                { color: "#15803d", fontFamily: "Outfit_500Medium" },
              ]}
            >
              Uploaded successfully!
            </Text>
          </View>
        )}

        {mode === "photo" && (
          <View style={styles.actionGrid}>
            <ActionCard
              colors={colors}
              icon="camera"
              label="Take Photo"
              sub="Use your camera"
              onPress={handleTakePhoto}
              disabled={isUploading || eventEnded}
            />
            <ActionCard
              colors={colors}
              icon="image"
              label="Choose Photo"
              sub="From your library"
              onPress={handlePickPhoto}
              disabled={isUploading || eventEnded}
            />
          </View>
        )}

        {mode === "video" && (
          <View style={styles.actionGrid}>
            <ActionCard
              colors={colors}
              icon="video"
              label="Record Video"
              sub="Up to 2 minutes"
              onPress={handleRecordVideo}
              disabled={isUploading || eventEnded}
            />
            <ActionCard
              colors={colors}
              icon="film"
              label="Choose Video"
              sub="From your library"
              onPress={handlePickVideo}
              disabled={isUploading || eventEnded}
            />
          </View>
        )}

        {mode === "voice" && (
          <View style={styles.voiceSection}>
            <View
              style={[
                styles.voiceRing,
                {
                  borderColor: recording ? colors.destructive : colors.primary,
                  backgroundColor: recording
                    ? `${colors.destructive}15`
                    : colors.muted,
                },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.voiceMainBtn,
                  {
                    backgroundColor: recording
                      ? colors.destructive
                      : colors.primary,
                    opacity: eventEnded ? 0.5 : 1,
                  },
                ]}
                onPress={recording ? stopVoiceRecording : startVoiceRecording}
                disabled={isUploading || eventEnded}
                activeOpacity={0.8}
              >
                <Feather
                  name={recording ? "square" : "mic"}
                  size={36}
                  color={colors.primaryForeground}
                />
              </TouchableOpacity>
            </View>

            {recording ? (
              <View style={styles.recordingInfo}>
                <View
                  style={[styles.recDot, { backgroundColor: colors.destructive }]}
                />
                <Text
                  style={[
                    styles.recTimer,
                    {
                      color: colors.foreground,
                      fontFamily: "Outfit_700Bold",
                    },
                  ]}
                >
                  {formatDuration(recordingDuration)}
                </Text>
                <Text
                  style={[
                    styles.recHint,
                    {
                      color: colors.mutedForeground,
                      fontFamily: "Outfit_400Regular",
                    },
                  ]}
                >
                  Tap the square to stop
                </Text>
              </View>
            ) : (
              <Text
                style={[
                  styles.voiceHint,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Outfit_400Regular",
                  },
                ]}
              >
                {eventEnded
                  ? "Event has ended"
                  : "Tap the mic to start recording"}
              </Text>
            )}
          </View>
        )}

        {!eventId && (
          <View style={styles.noEventWrap}>
            <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
            <Text
              style={[
                styles.noEventText,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Outfit_400Regular",
                },
              ]}
            >
              Join an event first to upload media.
            </Text>
          </View>
        )}
      </View>

      <View
        style={[
          styles.nameTag,
          { borderTopColor: colors.border, paddingBottom: botPad + 80 },
        ]}
      >
        <Feather name="user" size={14} color={colors.mutedForeground} />
        <Text
          style={[
            styles.nameTagText,
            { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
          ]}
        >
          Uploading as {guestName ?? "Guest"}
        </Text>
      </View>
    </View>
  );
}

function ActionCard({
  colors,
  icon,
  label,
  sub,
  onPress,
  disabled,
}: {
  colors: ReturnType<typeof useColors>;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  sub: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      <View
        style={[
          styles.actionIconWrap,
          { backgroundColor: colors.muted },
        ]}
      >
        <Feather name={icon} size={26} color={colors.primary} />
      </View>
      <Text
        style={[
          styles.actionLabel,
          { color: colors.foreground, fontFamily: "Outfit_600SemiBold" },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.actionSub,
          { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
        ]}
      >
        {sub}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heading: { fontSize: 28, paddingHorizontal: 20, marginBottom: 16 },

  endedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 10,
  },
  endedText: { fontSize: 13, flex: 1, lineHeight: 18 },

  modeBar: {
    flexDirection: "row",
    marginHorizontal: 20,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
    marginBottom: 20,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
  },
  modeBtnText: { fontSize: 14 },

  content: { flex: 1, paddingHorizontal: 20 },

  uploadBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  uploadText: { fontSize: 14 },

  actionGrid: { flexDirection: "row", gap: 12 },
  actionCard: {
    flex: 1,
    borderWidth: 1,
    padding: 20,
    gap: 10,
    alignItems: "center",
  },
  actionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: 15, textAlign: "center" },
  actionSub: { fontSize: 12, textAlign: "center" },

  voiceSection: { flex: 1, alignItems: "center", justifyContent: "center", gap: 28 },
  voiceRing: {
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceMainBtn: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
  },
  recordingInfo: { alignItems: "center", gap: 8 },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  recTimer: { fontSize: 40 },
  recHint: { fontSize: 14 },
  voiceHint: { fontSize: 15, textAlign: "center", paddingHorizontal: 32 },

  noEventWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  noEventText: { fontSize: 15, textAlign: "center", lineHeight: 22 },

  nameTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  nameTagText: { fontSize: 13 },
});
