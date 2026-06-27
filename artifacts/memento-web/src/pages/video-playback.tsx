import { useParams, useLocation } from "wouter";
import {
  useGetEventByToken,
  useGetEventVideoStatusByToken,
  getGetEventVideoStatusByTokenQueryKey,
  getGetEventByTokenQueryKey,
} from "@workspace/api-client-react";
import {
  Film, Loader2, AlertCircle, Clock, ArrowLeft, Download, Smartphone, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const APP_STORE_URL = "https://apps.apple.com/";
const PLAY_STORE_URL = "https://play.google.com/";

function AppDownloadBanner() {
  return (
    <Card className="mt-8 border-primary/20 bg-primary/5" data-testid="card-app-download">
      <CardContent className="py-5 flex flex-col sm:flex-row items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Smartphone className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <p className="font-semibold text-sm">Get the Memento app</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Download photos, re-watch the edit, and share memories right from your phone.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-app-store"
          >
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              App Store
            </Button>
          </a>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-play-store"
          >
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 20.5v-17c0-.83 1-.97 1.4-.5l14 8.5c.4.23.4.77 0 1L4.4 21c-.4.47-1.4.33-1.4-.5zm2-13.5v11l9.3-5.5L5 7z" />
              </svg>
              Google Play
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function UpgradeBanner({ tier }: { tier?: string | null }) {
  if (tier && tier !== "free") return null;

  function handleUpgrade() {
    window.location.href = "/host?upgrade=pro";
  }

  return (
    <Card className="mt-4 border-amber-200 bg-amber-50" data-testid="card-upgrade-prompt">
      <CardContent className="py-5 flex flex-col sm:flex-row items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Star className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <p className="font-semibold text-sm text-amber-900">Your edit is capped at 60 seconds</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Upgrade to Pro to get up to 5 minutes — every moment, not just the highlights.
          </p>
        </div>
        <Button size="sm" className="flex-shrink-0" onClick={handleUpgrade} data-testid="link-upgrade">
          Upgrade to Pro
        </Button>
      </CardContent>
    </Card>
  );
}

export default function VideoPlayback() {
  const params = useParams<{ shareToken: string }>();
  const shareToken = params.shareToken;
  const [, setLocation] = useLocation();

  // Public endpoint — works for any recipient on any device, no auth required.
  // Uses shareToken directly so email links always resolve correctly.
  const { data: eventInfo, isLoading: eventLoading } = useGetEventByToken(shareToken, {
    query: { queryKey: getGetEventByTokenQueryKey(shareToken) },
  });

  const { data: videoStatus, isLoading: videoLoading } = useGetEventVideoStatusByToken(shareToken, {
    query: {
      queryKey: getGetEventVideoStatusByTokenQueryKey(shareToken),
      // Poll while compiling; stop once done/failed
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return s === "pending" || s === "processing" ? 3000 : false;
      },
    },
  });

  const isLoading = eventLoading || videoLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!eventInfo) {
    return (
      <div
        className="min-h-screen bg-background flex items-center justify-center px-6"
        data-testid="error-event-not-found"
      >
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="font-serif text-2xl font-bold mb-2">Event not found</h2>
          <p className="text-muted-foreground">This video link may have expired.</p>
        </div>
      </div>
    );
  }

  const capSeconds = videoStatus?.durationCapSeconds ?? 60;
  const capLabel = `${Math.floor(capSeconds / 60)}:${String(capSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation(`/event/${shareToken}`)}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            <h1 className="font-serif font-bold text-base leading-tight">{eventInfo.title}</h1>
            <p className="text-xs text-muted-foreground">Same-day edit</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <Film className="w-4 h-4 text-primary-foreground" />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* No job yet — event may not have ended or no video compiled */}
        {!videoStatus ? (
          <>
            <div
              className="text-center py-20 rounded-2xl border border-dashed border-border"
              data-testid="no-video"
            >
              <Film className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
              <h2 className="font-serif text-2xl font-bold mb-2">No video yet</h2>
              <p className="text-muted-foreground">
                The same-day edit is compiled after the event ends.
              </p>
            </div>
            <AppDownloadBanner />
          </>
        ) : videoStatus.status === "completed" && videoStatus.videoUrl ? (
          <div data-testid="video-complete">
            <div className="rounded-2xl overflow-hidden bg-black mb-4 shadow-xl">
              <video controls autoPlay className="w-full" data-testid="video-player">
                <source src={videoStatus.videoUrl} />
                Your browser doesn't support video.
              </video>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{eventInfo.title} — Same-day edit</p>
                <p className="text-sm text-muted-foreground">
                  {videoStatus.tier ?? "free"} tier · {capLabel} cap
                </p>
              </div>
              <a href={videoStatus.videoUrl} download>
                <Button variant="outline" className="gap-1.5" data-testid="button-download-video">
                  <Download className="w-4 h-4" />
                  Download
                </Button>
              </a>
            </div>
            <UpgradeBanner tier={videoStatus.tier} />
            <AppDownloadBanner />
          </div>
        ) : videoStatus.status === "failed" ? (
          <>
            <div
              className="text-center py-20 rounded-2xl border border-destructive/20 bg-destructive/5"
              data-testid="video-failed"
            >
              <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
              <h2 className="font-serif text-2xl font-bold mb-2">Video generation failed</h2>
              <p className="text-muted-foreground">
                {videoStatus.errorMessage ?? "Something went wrong."}
              </p>
            </div>
            <AppDownloadBanner />
          </>
        ) : (
          /* pending | processing */
          <>
            <div
              className="text-center py-20 rounded-2xl border border-border bg-card"
              data-testid="video-processing"
            >
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                {videoStatus.status === "processing" ? (
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                ) : (
                  <Clock className="w-10 h-10 text-primary" />
                )}
              </div>
              <h2 className="font-serif text-2xl font-bold mb-2">
                {videoStatus.status === "processing"
                  ? "Editing your memories..."
                  : "In the queue"}
              </h2>
              <p className="text-muted-foreground max-w-sm mx-auto">
                {videoStatus.status === "processing"
                  ? "We're compiling all the photos, videos, and voice notes into your same-day edit. This usually takes a few minutes."
                  : "Your video is in the queue and will start processing shortly."}
              </p>
              <div className="mt-6 text-sm text-muted-foreground">
                {videoStatus.tier ?? "free"} tier · up to {capLabel}
              </div>
            </div>
            <UpgradeBanner tier={videoStatus.tier} />
            <AppDownloadBanner />
          </>
        )}
      </main>
    </div>
  );
}
