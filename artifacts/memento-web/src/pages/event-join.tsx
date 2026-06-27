import { useState, useRef, useEffect } from "react";
import { useParams } from "wouter";
import {
  useGetEventByToken,
  useJoinEvent,
  useListEventMedia,
  useConfirmMediaUpload,
  useRequestUploadUrl,
  getGetEventByTokenQueryKey,
  getListEventMediaQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Camera, Upload, Mic, Film, Users, Loader2, CheckCircle, Clock,
  Radio, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const guestTokenKey = (eventId: string) => `memento_guest_${eventId}`;

const statusConfig = {
  upcoming: { label: "Upcoming", icon: Clock, className: "bg-blue-100 text-blue-700" },
  live: { label: "Live", icon: Radio, className: "bg-green-100 text-green-700" },
  ended: { label: "Ended", icon: CheckCircle, className: "bg-muted text-muted-foreground" },
};

type MediaType = "photo" | "video" | "voice_note";

function detectMediaType(file: File): MediaType {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "voice_note";
  return "photo";
}

interface GuestFeedProps {
  eventId: string;
  guestToken: string;
}

function GuestFeed({ eventId, guestToken }: GuestFeedProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data } = useListEventMedia(eventId, {
    query: {
      queryKey: getListEventMediaQueryKey(eventId),
      refetchInterval: 10000,
    },
  });

  const guestHeaders = { headers: { "X-Guest-Token": guestToken } };

  const requestUploadUrl = useRequestUploadUrl({ request: guestHeaders });
  const confirmUpload = useConfirmMediaUpload({ request: guestHeaders });

  const items = data?.media ?? [];

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const mediaType = detectMediaType(file);

      const urlRes = await new Promise<{ uploadURL: string; objectPath: string }>((resolve, reject) => {
        requestUploadUrl.mutate(
          { data: { name: file.name, size: file.size, contentType: file.type } },
          { onSuccess: resolve, onError: reject }
        );
      });

      await fetch(urlRes.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      await new Promise<void>((resolve, reject) => {
        confirmUpload.mutate(
          {
            eventId,
            data: {
              objectPath: urlRes.objectPath,
              mediaType,
              fileName: file.name,
              fileSizeBytes: file.size,
            },
          },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListEventMediaQueryKey(eventId) });
              resolve();
            },
            onError: reject,
          }
        );
      });

      toast({ title: "Uploaded!", description: "Your moment has been added to the feed." });
    } catch {
      toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div>
      {/* Upload bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3">
        <span className="text-sm text-muted-foreground flex-1">Share a moment</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={handleFileSelect}
          data-testid="input-file-upload"
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          data-testid="button-upload-media"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? "Uploading..." : "Add photo/video"}
        </Button>
      </div>

      {/* Feed */}
      <div className="p-4">
        {items.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground" data-testid="empty-feed">
            <Camera className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No photos yet</p>
            <p className="text-sm mt-1">Be the first to share a moment</p>
          </div>
        ) : (
          <div className="columns-2 sm:columns-3 gap-3 space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="break-inside-avoid rounded-xl overflow-hidden bg-muted border border-border"
                data-testid={`card-feed-item-${item.id}`}
              >
                {item.mediaType === "photo" && item.objectPath && (
                  <img
                    src={`/api/storage/objects/${item.objectPath}`}
                    alt={item.fileName ?? "Photo"}
                    className="w-full object-cover"
                    loading="lazy"
                  />
                )}
                {item.mediaType === "video" && (
                  <div className="aspect-video flex items-center justify-center bg-black/10">
                    <Film className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}
                {item.mediaType === "voice_note" && (
                  <div className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Mic className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Voice note</p>
                      {item.durationSeconds && (
                        <p className="text-xs text-muted-foreground">{item.durationSeconds}s</p>
                      )}
                    </div>
                  </div>
                )}
                <div className="px-3 py-2 bg-card">
                  <p className="text-xs font-medium truncate">{item.uploaderDisplayName ?? "Guest"}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(item.createdAt), "h:mm a")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EventJoin() {
  const params = useParams<{ shareToken: string }>();
  const shareToken = params.shareToken;
  const { toast } = useToast();

  const [guestToken, setGuestToken] = useState<string | null>(null);

  const { data: eventInfo, isLoading } = useGetEventByToken(shareToken, {
    query: { queryKey: getGetEventByTokenQueryKey(shareToken) },
  });

  useEffect(() => {
    if (eventInfo?.id) {
      const stored = localStorage.getItem(guestTokenKey(eventInfo.id));
      if (stored) setGuestToken(stored);
    }
  }, [eventInfo?.id]);

  const joinEvent = useJoinEvent();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [referralCode, setReferralCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("ref") ?? "";
  });

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !eventInfo) return;
    joinEvent.mutate(
      { data: { shareToken, displayName: name, email: email || undefined, referralCode: referralCode.trim() || undefined } },
      {
        onSuccess: (res) => {
          const token = res.guest.guestToken ?? res.guest.id;
          localStorage.setItem(guestTokenKey(eventInfo.id), token);
          setGuestToken(token);
        },
        onError: () => toast({ title: "Failed to join event", variant: "destructive" }),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!eventInfo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6" data-testid="error-event-not-found">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="font-serif text-2xl font-bold mb-2">Event not found</h2>
          <p className="text-muted-foreground">This event link may have expired or been removed.</p>
        </div>
      </div>
    );
  }

  const cfg = statusConfig[eventInfo.status as keyof typeof statusConfig] ?? statusConfig.upcoming;
  const StatusIcon = cfg.icon;

  return (
    <div className="min-h-screen bg-background">
      {/* Event header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
              <Camera className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="font-serif text-2xl font-bold">{eventInfo.title}</h1>
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.className}`} data-testid="badge-event-status">
                  <StatusIcon className="w-3 h-3" />
                  {cfg.label}
                </span>
              </div>
              {eventInfo.description && (
                <p className="text-muted-foreground text-sm mb-2">{eventInfo.description}</p>
              )}
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                {eventInfo.hostName && <span>Hosted by <strong className="text-foreground">{eventInfo.hostName}</strong></span>}
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {eventInfo.guestCount} {eventInfo.guestCount === 1 ? "guest" : "guests"}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {format(new Date(eventInfo.eventDate), "MMM d, yyyy")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto">
        {!guestToken ? (
          /* Join form */
          <div className="px-6 py-10" data-testid="join-form">
            <h2 className="font-serif text-2xl font-bold mb-2">Join {eventInfo.title}</h2>
            <p className="text-muted-foreground mb-6">
              Add your name to access the shared photo stream and contribute your own memories. No app download required.
            </p>
            <form onSubmit={handleJoin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  placeholder="Alex Johnson"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  data-testid="input-guest-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="alex@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-guest-email"
                />
                <p className="text-xs text-muted-foreground">
                  We'll send you the same-day edit video when it's ready
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="referralCode">Vendor referral code (optional)</Label>
                <Input
                  id="referralCode"
                  placeholder="e.g. JANESMITH"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  data-testid="input-referral-code"
                />
                <p className="text-xs text-muted-foreground">
                  Got a code from your photographer or event planner? Enter it for an extended video edit.
                </p>
              </div>
              <Button
                type="submit"
                className="w-full mt-2"
                disabled={joinEvent.isPending}
                data-testid="button-join-event"
              >
                {joinEvent.isPending ? "Joining..." : "Join and view photos"}
              </Button>
            </form>
          </div>
        ) : (
          /* Guest feed */
          <GuestFeed eventId={eventInfo.id} guestToken={guestToken} />
        )}
      </div>
    </div>
  );
}
