import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import {
  CameraType,
  CameraView,
  FlashMode,
  useCameraPermissions,
  useMicrophonePermissions,
} from "expo-camera";
import * as Haptics from "expo-haptics";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
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

const { height: SCREEN_H } = Dimensions.get("window");

async function putBlob(
  uploadURL: string,
  uri: string,
  contentType: string
): Promise<void> {
  const response = await globalThis.fetch(uri);
  const blob = await response.blob();
  const put = await globalThis.fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
}

export default function CameraScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { eventId, guestToken, guestName, eventStatus } = useEvent();

  const [mode, setMode] = useState<CaptureMode>("photo");
  const [cameraFacing, setCameraFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoTimer, setVideoTimer] = useState(0);
  const [voiceRecording, setVoiceRecording] = useState<Audio.Recording | null>(null);
  const [voiceTimer, setVoiceTimer] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [uploadMsg, setUploadMsg] = useState("");

  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const voiceStartRef = useRef<number | null>(null);

  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  const requestUploadUrl = useRequestUploadUrl({
    request: { headers: { "X-Guest-Token": guestToken ?? "" } },
  });
  const confirmUpload = useConfirmMediaUpload({
    request: { headers: { "X-Guest-Token": guestToken ?? "" } },
  });

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;
  const isUploading = uploadStatus === "uploading";
  const eventEnded = eventStatus === "ended";

  const doUpload = useCallback(
    async (
      uri: string,
      fileName: string,
      contentType: string,
      mediaType: "photo" | "video" | "voice_note",
      fileSizeBytes?: number,
      durationSeconds?: number,
      capturedAt?: string
    ) => {
      if (!eventId) {
        Alert.alert("No event", "You are not part of an event.");
        return;
      }
      setUploadStatus("uploading");
      setUploadMsg("Preparing…");
      try {
        const urlRes = await new Promise<{ uploadURL: string; objectPath: string }>(
          (res, rej) => {
            requestUploadUrl.mutate(
              { data: { name: fileName, size: fileSizeBytes ?? 1, contentType } },
              { onSuccess: res, onError: rej }
            );
          }
        );
        setUploadMsg("Uploading…");
        await putBlob(urlRes.uploadURL, uri, contentType);
        setUploadMsg("Saving…");
        await new Promise<void>((res, rej) => {
          confirmUpload.mutate(
            {
              eventId,
              data: {
                objectPath: urlRes.objectPath,
                mediaType,
                fileName,
                fileSizeBytes,
                durationSeconds,
                capturedAt,
              },
            },
            { onSuccess: () => res(), onError: rej }
          );
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setUploadStatus("success");
        setTimeout(() => setUploadStatus("idle"), 2500);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        setUploadStatus("error");
        setUploadMsg(msg);
        Alert.alert("Upload failed", msg);
        setTimeout(() => setUploadStatus("idle"), 3000);
      }
    },
    [eventId, requestUploadUrl, confirmUpload]
  );

  const startTimer = (setter: React.Dispatch<React.SetStateAction<number>>) => {
    setter(0);
    timerRef.current = setInterval(() => setter((v) => v + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const formatDur = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const handleTakePhoto = async () => {
    if (isUploading || eventEnded || !cameraRef.current) return;
    const capturedAt = new Date().toISOString();
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await doUpload(
        photo.uri,
        `photo_${Date.now()}.jpg`,
        "image/jpeg",
        "photo",
        undefined,
        undefined,
        capturedAt
      );
    } catch (e) {
      Alert.alert("Capture error", e instanceof Error ? e.message : "Failed");
    }
  };

  const handleStartVideo = async () => {
    if (isUploading || eventEnded || !cameraRef.current || isRecordingVideo) return;
    if (!micPerm?.granted) {
      const res = await requestMicPerm();
      if (!res.granted) {
        Alert.alert("Permission needed", "Microphone access required for video.");
        return;
      }
    }
    try {
      setIsRecordingVideo(true);
      startTimer(setVideoTimer);
      recordingStartRef.current = Date.now();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const video = await cameraRef.current.recordAsync({ maxDuration: 120 });
      const duration = recordingStartRef.current
        ? Math.round((Date.now() - recordingStartRef.current) / 1000)
        : undefined;
      const capturedAt = recordingStartRef.current
        ? new Date(recordingStartRef.current).toISOString()
        : new Date().toISOString();
      recordingStartRef.current = null;
      stopTimer();
      setIsRecordingVideo(false);
      setVideoTimer(0);
      if (video?.uri) {
        await doUpload(
          video.uri,
          `video_${Date.now()}.mp4`,
          "video/mp4",
          "video",
          undefined,
          duration,
          capturedAt
        );
      }
    } catch {
      recordingStartRef.current = null;
      stopTimer();
      setIsRecordingVideo(false);
      setVideoTimer(0);
    }
  };

  const handleStopVideo = () => {
    cameraRef.current?.stopRecording();
  };

  const handleStartVoice = async () => {
    if (isUploading || eventEnded || voiceRecording) return;
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Microphone access required.");
      return;
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await rec.startAsync();
    voiceStartRef.current = Date.now();
    setVoiceRecording(rec);
    startTimer(setVoiceTimer);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleStopVoice = async () => {
    if (!voiceRecording) return;
    const dur = voiceStartRef.current
      ? Math.round((Date.now() - voiceStartRef.current) / 1000)
      : undefined;
    const capturedAt = voiceStartRef.current
      ? new Date(voiceStartRef.current).toISOString()
      : new Date().toISOString();
    voiceStartRef.current = null;
    stopTimer();
    await voiceRecording.stopAndUnloadAsync();
    const uri = voiceRecording.getURI();
    setVoiceRecording(null);
    setVoiceTimer(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!uri) return;
    await doUpload(
      uri,
      `voice_${Date.now()}.m4a`,
      "audio/m4a",
      "voice_note",
      undefined,
      dur ?? 0,
      capturedAt
    );
  };

  const needsCamPerm = mode !== "voice" && (!camPerm || !camPerm.granted);

  return (
    <View style={[styles.root, { backgroundColor: "#000" }]}>
      {mode !== "voice" && !needsCamPerm && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={cameraFacing}
          flash={flash}
        />
      )}

      {mode === "voice" && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.background },
          ]}
        />
      )}

      {needsCamPerm && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
          ]}
        >
          <Feather name="camera-off" size={48} color={colors.mutedForeground} />
          <Text
            style={[
              styles.permText,
              { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
            ]}
          >
            Camera access is needed to capture moments.
          </Text>
          <TouchableOpacity
            style={[styles.permBtn, { backgroundColor: colors.primary }]}
            onPress={requestCamPerm}
            activeOpacity={0.8}
          >
            <Text style={[styles.permBtnText, { color: colors.primaryForeground, fontFamily: "Outfit_600SemiBold" }]}>
              Allow Camera
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View
        style={[
          styles.topBar,
          { paddingTop: topPad + 8 },
        ]}
      >
        <View style={styles.modeRow}>
          {(["photo", "video", "voice"] as CaptureMode[]).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setMode(m)}
              style={[
                styles.modeChip,
                mode === m && { backgroundColor: "rgba(255,255,255,0.25)" },
              ]}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.modeText,
                  {
                    color: mode === m ? "#fff" : "rgba(255,255,255,0.6)",
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

        {mode !== "voice" && (
          <View style={styles.topControls}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() =>
                setFlash((f) => (f === "off" ? "on" : "off"))
              }
              activeOpacity={0.8}
            >
              <Feather
                name={flash === "off" ? "zap-off" : "zap"}
                size={22}
                color="#fff"
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() =>
                setCameraFacing((f) => (f === "back" ? "front" : "back"))
              }
              activeOpacity={0.8}
            >
              <Feather name="refresh-cw" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {(isRecordingVideo || voiceRecording) && (
        <View style={styles.timerBadge}>
          <View style={[styles.recDot, { backgroundColor: colors.destructive }]} />
          <Text style={[styles.timerText, { fontFamily: "Outfit_700Bold" }]}>
            {formatDur(isRecordingVideo ? videoTimer : voiceTimer)}
          </Text>
        </View>
      )}

      {uploadStatus !== "idle" && (
        <View
          style={[
            styles.uploadBadge,
            {
              backgroundColor:
                uploadStatus === "success"
                  ? "#16a34a"
                  : uploadStatus === "error"
                  ? colors.destructive
                  : "rgba(0,0,0,0.7)",
            },
          ]}
        >
          {uploadStatus === "uploading" ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather
              name={uploadStatus === "success" ? "check" : "x"}
              size={16}
              color="#fff"
            />
          )}
          <Text style={[styles.uploadText, { fontFamily: "Outfit_500Medium" }]}>
            {uploadStatus === "uploading"
              ? uploadMsg
              : uploadStatus === "success"
              ? "Uploaded!"
              : "Upload failed"}
          </Text>
        </View>
      )}

      {eventEnded && (
        <View style={styles.endedBanner}>
          <Text style={[styles.endedText, { fontFamily: "Outfit_400Regular" }]}>
            Event ended — uploads disabled
          </Text>
        </View>
      )}

      <View
        style={[
          styles.bottomBar,
          { paddingBottom: botPad + 90 },
        ]}
      >
        {mode === "photo" && (
          <TouchableOpacity
            style={[
              styles.shutterBtn,
              { opacity: isUploading || eventEnded || needsCamPerm ? 0.4 : 1 },
            ]}
            onPress={handleTakePhoto}
            disabled={isUploading || eventEnded || needsCamPerm}
            activeOpacity={0.8}
          >
            <View style={styles.shutterInner} />
          </TouchableOpacity>
        )}

        {mode === "video" && (
          <TouchableOpacity
            style={[
              styles.shutterBtn,
              {
                opacity: isUploading || eventEnded || needsCamPerm ? 0.4 : 1,
                borderColor: isRecordingVideo ? colors.destructive : "#fff",
              },
            ]}
            onPressIn={!isRecordingVideo ? handleStartVideo : undefined}
            onPressOut={isRecordingVideo ? handleStopVideo : undefined}
            disabled={isUploading || eventEnded || needsCamPerm}
            activeOpacity={0.8}
          >
            {isRecordingVideo ? (
              <View
                style={[
                  styles.stopSquare,
                  { backgroundColor: colors.destructive },
                ]}
              />
            ) : (
              <View
                style={[styles.shutterInner, { backgroundColor: colors.destructive }]}
              />
            )}
          </TouchableOpacity>
        )}

        {mode === "voice" && (
          <View style={styles.voiceCenter}>
            <TouchableOpacity
              style={[
                styles.voiceRing,
                {
                  borderColor: voiceRecording
                    ? colors.destructive
                    : "rgba(255,255,255,0.4)",
                  opacity: isUploading || eventEnded ? 0.4 : 1,
                },
              ]}
              onPressIn={!voiceRecording ? handleStartVoice : undefined}
              onPressOut={voiceRecording ? handleStopVoice : undefined}
              disabled={isUploading || eventEnded}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.voiceBtn,
                  {
                    backgroundColor: voiceRecording
                      ? colors.destructive
                      : colors.primary,
                  },
                ]}
              >
                <Feather
                  name={voiceRecording ? "square" : "mic"}
                  size={34}
                  color="#fff"
                />
              </View>
            </TouchableOpacity>
            <Text
              style={[
                styles.voiceHint,
                { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
              ]}
            >
              {voiceRecording
                ? "Tap to stop"
                : eventEnded
                ? "Event ended"
                : "Tap to record"}
            </Text>
          </View>
        )}

        <View style={styles.guestTag}>
          <Feather name="user" size={13} color="rgba(255,255,255,0.5)" />
          <Text
            style={[
              styles.guestText,
              { fontFamily: "Outfit_400Regular" },
            ]}
          >
            {guestName ?? "Guest"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    gap: 12,
    zIndex: 10,
  },
  modeRow: {
    flexDirection: "row",
    alignSelf: "center",
    gap: 4,
  },
  modeChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  modeText: { fontSize: 14 },
  topControls: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  timerBadge: {
    position: "absolute",
    top: "50%",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 10,
  },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  timerText: { color: "#fff", fontSize: 22 },
  uploadBadge: {
    position: "absolute",
    bottom: 160,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 10,
  },
  uploadText: { color: "#fff", fontSize: 14 },
  endedBanner: {
    position: "absolute",
    top: 120,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    zIndex: 10,
  },
  endedText: { color: "#fff", fontSize: 13 },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 16,
    zIndex: 10,
  },
  shutterBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff",
  },
  stopSquare: {
    width: 30,
    height: 30,
    borderRadius: 6,
  },
  voiceCenter: { alignItems: "center", gap: 16 },
  voiceRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceBtn: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceHint: { fontSize: 14, textAlign: "center" },
  guestTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  guestText: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  permText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  permBtn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12 },
  permBtnText: { fontSize: 16 },
});
