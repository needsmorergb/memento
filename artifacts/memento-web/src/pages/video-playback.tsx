import { useParams, useLocation } from "wouter";
import { useGetEventByToken, useGetEventVideoStatus, getGetEventVideoStatusQueryKey, getGetEventByTokenQueryKey } from "@workspace/api-client-react";
import { Film, Loader2, AlertCircle, Clock, CheckCircle, ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function VideoPlayback() {
  const params = useParams<{ shareToken: string }>();
  const shareToken = params.shareToken;
  const [, setLocation] = useLocation();

  const { data: eventInfo, isLoading: eventLoading } = useGetEventByToken(shareToken, {
    query: { queryKey: getGetEventByTokenQueryKey(shareToken) },
  });

  const { data: videoStatus, isLoading: videoLoading } = useGetEventVideoStatus(eventInfo?.id ?? "", {
    query: {
      enabled: !!eventInfo?.id,
      queryKey: getGetEventVideoStatusQueryKey(eventInfo?.id ?? ""),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "pending" || status === "processing" ? 3000 : false;
      },
    },
  });

  if (eventLoading || videoLoading) {
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
      <div className="min-h-screen bg-background flex items-center justify-center px-6" data-testid="error-event-not-found">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="font-serif text-2xl font-bold mb-2">Event not found</h2>
          <p className="text-muted-foreground">This video link may have expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`/event/${shareToken}`)} data-testid="button-back">
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
        {!videoStatus ? (
          <div className="text-center py-20 rounded-2xl border border-dashed border-border" data-testid="no-video">
            <Film className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
            <h2 className="font-serif text-2xl font-bold mb-2">No video yet</h2>
            <p className="text-muted-foreground">
              The same-day edit is only compiled after the event ends.
            </p>
          </div>
        ) : videoStatus.status === "completed" && videoStatus.videoUrl ? (
          <div data-testid="video-complete">
            <div className="rounded-2xl overflow-hidden bg-black mb-4 shadow-xl">
              <video
                controls
                autoPlay
                className="w-full"
                data-testid="video-player"
              >
                <source src={videoStatus.videoUrl} />
                Your browser doesn't support video.
              </video>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{eventInfo.title} — Same-day edit</p>
                <p className="text-sm text-muted-foreground">
                  {videoStatus.tier ?? "standard"} · {Math.floor((videoStatus.durationCapSeconds ?? 60) / 60)}:{String((videoStatus.durationCapSeconds ?? 60) % 60).padStart(2, "0")} cap
                </p>
              </div>
              <a href={videoStatus.videoUrl} download>
                <Button variant="outline" className="gap-1.5" data-testid="button-download-video">
                  <Download className="w-4 h-4" />
                  Download
                </Button>
              </a>
            </div>
          </div>
        ) : videoStatus.status === "failed" ? (
          <div className="text-center py-20 rounded-2xl border border-destructive/20 bg-destructive/5" data-testid="video-failed">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="font-serif text-2xl font-bold mb-2">Video generation failed</h2>
            <p className="text-muted-foreground">{videoStatus.errorMessage ?? "Something went wrong."}</p>
          </div>
        ) : (
          <div className="text-center py-20 rounded-2xl border border-border bg-card" data-testid="video-processing">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              {videoStatus.status === "processing" ? (
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              ) : (
                <Clock className="w-10 h-10 text-primary" />
              )}
            </div>
            <h2 className="font-serif text-2xl font-bold mb-2">
              {videoStatus.status === "processing" ? "Editing your memories..." : "In the queue"}
            </h2>
            <p className="text-muted-foreground max-w-sm mx-auto">
              {videoStatus.status === "processing"
                ? "We're compiling all the photos, videos, and voice notes into your same-day edit. This usually takes a few minutes."
                : "Your video is in the queue and will start processing shortly."}
            </p>
            <div className="mt-6 text-sm text-muted-foreground">
              {videoStatus.tier ?? "standard"} · up to {Math.floor((videoStatus.durationCapSeconds ?? 60) / 60)}:{String((videoStatus.durationCapSeconds ?? 60) % 60).padStart(2, "0")}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
