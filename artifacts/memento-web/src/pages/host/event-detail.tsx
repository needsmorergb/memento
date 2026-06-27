import { useState, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetEvent,
  useListEventGuests,
  useListEventMedia,
  useGetEventQrPayload,
  useGetEventVideoStatus,
  useEndEvent,
  useDeleteEvent,
  getGetEventQueryKey,
  getGetEventVideoStatusQueryKey,
  getGetEventQrPayloadQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft, QrCode, Users, Image, Film, StopCircle, Trash2,
  Download, Copy, Calendar, Clock, Radio, CheckCircle, Loader2,
  Camera, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const statusConfig = {
  upcoming: { label: "Upcoming", icon: Clock, className: "bg-blue-100 text-blue-700" },
  live: { label: "Live", icon: Radio, className: "bg-green-100 text-green-700" },
  ended: { label: "Ended", icon: CheckCircle, className: "bg-muted text-muted-foreground" },
};

const videoStatusConfig = {
  pending: { label: "In queue", icon: Clock, className: "text-muted-foreground" },
  processing: { label: "Processing", icon: Loader2, className: "text-blue-600 animate-spin" },
  completed: { label: "Ready", icon: CheckCircle, className: "text-green-600" },
  failed: { label: "Failed", icon: AlertCircle, className: "text-destructive" },
};

function MediaGrid({ eventId }: { eventId: string }) {
  const { data, isLoading } = useListEventMedia(eventId);
  const items = data?.media ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {[...Array(8)].map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground" data-testid="empty-media">
        <Image className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No media uploaded yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="aspect-square rounded-xl overflow-hidden bg-muted border border-border relative"
          data-testid={`card-media-${item.id}`}
        >
          {item.mediaType === "photo" && item.objectPath && (
            <img
              src={`/api/storage/objects/${item.objectPath}`}
              alt={item.fileName ?? "Photo"}
              className="w-full h-full object-cover"
            />
          )}
          {item.mediaType === "video" && (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <Film className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
          {item.mediaType === "voice_note" && (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <div className="text-center">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                  <span className="text-primary text-xs font-bold">VN</span>
                </div>
                <span className="text-xs text-muted-foreground">Voice note</span>
              </div>
            </div>
          )}
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">
            <span className="text-white text-xs truncate block">
              {item.uploaderDisplayName ?? "Guest"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EventDetail() {
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const qrRef = useRef<HTMLDivElement>(null);

  const { data: event, isLoading } = useGetEvent(eventId);
  const { data: guestsData, isLoading: guestsLoading } = useListEventGuests(eventId);
  const { data: qrPayload } = useGetEventQrPayload(eventId, { query: { enabled: !!event, queryKey: getGetEventQrPayloadQueryKey(eventId) } });
  const { data: videoStatus } = useGetEventVideoStatus(eventId, {
    query: {
      enabled: event?.status === "ended",
      queryKey: getGetEventVideoStatusQueryKey(eventId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "pending" || status === "processing" ? 3000 : false;
      },
    },
  });

  const endEvent = useEndEvent();
  const deleteEvent = useDeleteEvent();

  const [showEndDialog, setShowEndDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const guests = guestsData?.guests ?? [];

  async function handleEndEvent() {
    endEvent.mutate(
      { eventId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
          setShowEndDialog(false);
          toast({ title: "Event ended", description: "Your same-day edit is being compiled." });
        },
        onError: () => toast({ title: "Failed to end event", variant: "destructive" }),
      }
    );
  }

  async function handleDelete() {
    deleteEvent.mutate(
      { eventId },
      {
        onSuccess: () => { setLocation("/host"); },
        onError: () => toast({ title: "Failed to delete event", variant: "destructive" }),
      }
    );
  }

  const copyShareUrl = useCallback(() => {
    if (!event?.shareUrl) return;
    navigator.clipboard.writeText(event.shareUrl).then(() => {
      toast({ title: "Link copied to clipboard" });
    });
  }, [event?.shareUrl, toast]);

  const downloadQr = useCallback(() => {
    if (!qrRef.current) return;
    const svg = qrRef.current.querySelector("svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `memento-qr-${event?.shareToken ?? "code"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [event?.shareToken]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" data-testid="error-not-found">
        <div className="text-center">
          <h2 className="font-serif text-2xl font-bold mb-2">Event not found</h2>
          <Button onClick={() => setLocation("/host")}>Back to dashboard</Button>
        </div>
      </div>
    );
  }

  const cfg = statusConfig[event.status] ?? statusConfig.upcoming;
  const StatusIcon = cfg.icon;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/host")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-lg font-bold truncate">{event.title}</h1>
          </div>
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${cfg.className}`} data-testid="badge-event-status">
            <StatusIcon className="w-3 h-3" />
            {cfg.label}
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Event info card */}
        <div className="rounded-2xl border border-border bg-card p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="font-serif text-2xl font-bold mb-1">{event.title}</h2>
              {event.description && <p className="text-muted-foreground mb-3">{event.description}</p>}
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  {format(new Date(event.eventDate), "MMMM d, yyyy 'at' h:mm a")}
                </span>
                {event.endTime && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Ends {format(new Date(event.endTime), "h:mm a")}
                  </span>
                )}
                <span className="flex items-center gap-1.5" data-testid="text-guest-count">
                  <Users className="w-3.5 h-3.5" />
                  {event.guestCount} guests
                </span>
                <span className="flex items-center gap-1.5" data-testid="text-media-count">
                  <Image className="w-3.5 h-3.5" />
                  {event.mediaCount} items
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              {event.status !== "ended" && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowEndDialog(true)}
                  data-testid="button-end-event"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  End event
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowDeleteDialog(true)} data-testid="button-delete-event">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Share URL */}
          <div className="mt-5 pt-5 border-t border-border flex items-center gap-3">
            <div className="flex-1 min-w-0 bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground truncate font-mono" data-testid="text-share-url">
              {event.shareUrl}
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0" onClick={copyShareUrl} data-testid="button-copy-link">
              <Copy className="w-3.5 h-3.5" />
              Copy link
            </Button>
          </div>
        </div>

        {/* Video status (when ended) */}
        {event.status === "ended" && videoStatus && (
          <div className="rounded-2xl border border-border bg-card p-6 mb-6" data-testid="card-video-status">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Film className="w-4 h-4 text-primary" />
              Same-day edit
            </h3>
            {videoStatus.status === "completed" && videoStatus.videoUrl ? (
              <div>
                <video controls className="w-full rounded-xl mb-3 bg-black" data-testid="video-player">
                  <source src={videoStatus.videoUrl} />
                </video>
                <a href={videoStatus.videoUrl} download>
                  <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-download-video">
                    <Download className="w-3.5 h-3.5" />
                    Download video
                  </Button>
                </a>
              </div>
            ) : videoStatus.status === "failed" ? (
              <div className="flex items-center gap-2 text-destructive text-sm" data-testid="text-video-failed">
                <AlertCircle className="w-4 h-4" />
                <span>Video generation failed: {videoStatus.errorMessage ?? "Unknown error"}</span>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-muted-foreground" data-testid="text-video-processing">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {videoStatusConfig[videoStatus.status]?.label ?? videoStatus.status}
                  </p>
                  <p className="text-xs">{videoStatus.tier ?? "standard"} · up to {Math.floor((videoStatus.durationCapSeconds ?? 60) / 60)}:{String((videoStatus.durationCapSeconds ?? 60) % 60).padStart(2, "0")}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="guests">
          <TabsList className="mb-6">
            <TabsTrigger value="guests" data-testid="tab-guests">
              <Users className="w-4 h-4 mr-1.5" /> Guests ({event.guestCount})
            </TabsTrigger>
            <TabsTrigger value="media" data-testid="tab-media">
              <Image className="w-4 h-4 mr-1.5" /> Media ({event.mediaCount})
            </TabsTrigger>
            <TabsTrigger value="qr" data-testid="tab-qr">
              <QrCode className="w-4 h-4 mr-1.5" /> QR Code
            </TabsTrigger>
          </TabsList>

          <TabsContent value="guests">
            {guestsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
              </div>
            ) : guests.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground" data-testid="empty-guests">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No guests have joined yet</p>
                <p className="text-sm mt-1">Share the QR code or join link to invite them</p>
              </div>
            ) : (
              <div className="space-y-2">
                {guests.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-card"
                    data-testid={`card-guest-${g.id}`}
                  >
                    <div>
                      <p className="font-medium text-sm" data-testid={`text-guest-name-${g.id}`}>{g.displayName}</p>
                      {g.email && <p className="text-xs text-muted-foreground">{g.email}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(g.joinedAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="media">
            <MediaGrid eventId={eventId} />
          </TabsContent>

          <TabsContent value="qr">
            {qrPayload ? (
              <div className="flex flex-col items-center py-8 gap-6" data-testid="card-qr-code">
                <div ref={qrRef} className="p-6 bg-white rounded-2xl shadow-lg border border-border">
                  <QRCodeSVG value={qrPayload.qrData} size={240} />
                </div>
                <p className="text-sm text-muted-foreground text-center max-w-xs">
                  Display this at your event. Guests scan to join instantly — no app needed.
                </p>
                <div className="flex gap-3">
                  <Button variant="outline" className="gap-1.5" onClick={downloadQr} data-testid="button-download-qr">
                    <Download className="w-4 h-4" />
                    Download QR
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={copyShareUrl} data-testid="button-copy-qr-link">
                    <Copy className="w-4 h-4" />
                    Copy join link
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin opacity-40" />
                <p>Loading QR code...</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* End Event Dialog */}
      <Dialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <DialogContent data-testid="dialog-end-event">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">End this event?</DialogTitle>
            <DialogDescription>
              This will close the event and trigger the same-day edit video compilation. Guests will no longer be able to upload.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEndDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleEndEvent}
              disabled={endEvent.isPending}
              data-testid="button-confirm-end"
            >
              {endEvent.isPending ? "Ending..." : "End event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Event Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent data-testid="dialog-delete-event">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Delete this event?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. All guests, media, and video data will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteEvent.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteEvent.isPending ? "Deleting..." : "Delete event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
