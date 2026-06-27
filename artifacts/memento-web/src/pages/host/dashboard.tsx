import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { useListMyEvents, useCreateEvent, useGetMySubscription, getListMyEventsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Plus, LogOut, Calendar, Users, Image, ChevronRight, Clock, CheckCircle, Radio, Star, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { redirectToCheckout, redirectToPortal } from "@/lib/billing";

const statusConfig = {
  upcoming: { label: "Upcoming", icon: Clock, className: "bg-blue-100 text-blue-700" },
  live: { label: "Live", icon: Radio, className: "bg-green-100 text-green-700" },
  ended: { label: "Ended", icon: CheckCircle, className: "bg-muted text-muted-foreground" },
};

export default function HostDashboard() {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: eventsData, isLoading } = useListMyEvents();
  const { data: subscription } = useGetMySubscription();
  const createEvent = useCreateEvent();

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [endTime, setEndTime] = useState("");

  // Handle return from Stripe checkout or auto-trigger upgrade
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const upgrade = params.get("upgrade") as "pro" | "vendor" | null;

    if (checkout === "success") {
      toast({
        title: "Subscription activated!",
        description: "Your plan is now active. Your next event will reflect the new video length cap.",
      });
      window.history.replaceState({}, "", "/host");
    } else if (checkout === "cancelled") {
      toast({ title: "Checkout cancelled", description: "No changes were made." });
      window.history.replaceState({}, "", "/host");
    } else if (upgrade === "pro" || upgrade === "vendor") {
      window.history.replaceState({}, "", "/host");
      redirectToCheckout(upgrade).catch(() =>
        toast({ title: "Billing error", description: "Could not open checkout. Please try again.", variant: "destructive" })
      );
    }
  }, []);

  const events = eventsData?.events ?? [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !eventDate) return;
    createEvent.mutate(
      { data: { title, description: description || undefined, eventDate: new Date(eventDate).toISOString(), endTime: endTime ? new Date(endTime).toISOString() : undefined } },
      {
        onSuccess: (event) => {
          queryClient.invalidateQueries({ queryKey: getListMyEventsQueryKey() });
          setShowCreate(false);
          setTitle(""); setDescription(""); setEventDate(""); setEndTime("");
          setLocation(`/host/events/${event.id}`);
        },
        onError: () => toast({ title: "Failed to create event", variant: "destructive" }),
      }
    );
  }

  const tierLabels: Record<string, string> = { free: "Free", pro: "Pro", vendor: "Vendor" };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <Camera className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-serif text-xl font-bold">Memento</span>
          </div>
          <div className="flex items-center gap-3">
            {subscription && (
              <Badge variant="outline" className="text-xs" data-testid="badge-tier">
                {tierLabels[subscription.tier] ?? subscription.tier}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground hidden sm:block" data-testid="text-user-name">
              {user?.firstName ?? user?.emailAddresses[0]?.emailAddress}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut({ redirectUrl: "/" })}
              data-testid="button-sign-out"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Top row */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-3xl font-bold mb-1">Your events</h1>
            <p className="text-muted-foreground text-sm">
              {events.length === 0 ? "No events yet" : `${events.length} event${events.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="gap-2" data-testid="button-create-event">
            <Plus className="w-4 h-4" />
            New event
          </Button>
        </div>

        {/* Tier / billing actions */}
        <div className="mb-8 flex flex-wrap gap-3">
          {subscription?.tier === "free" && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => redirectToCheckout("pro").catch(() => toast({ title: "Billing error", description: "Could not open checkout. Please try again.", variant: "destructive" }))}
              data-testid="button-upgrade-pro"
            >
              <Star className="w-3.5 h-3.5" />
              Upgrade to Pro
            </Button>
          )}
          {(subscription?.tier === "pro" || subscription?.tier === "vendor") && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => redirectToPortal().catch(() => toast({ title: "Billing error", description: "Could not open billing portal.", variant: "destructive" }))}
              data-testid="button-manage-subscription"
            >
              <Settings className="w-3.5 h-3.5" />
              Manage subscription
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setLocation("/vendor")} data-testid="button-vendor-portal">
            Vendor portal
          </Button>
        </div>

        {/* Events list */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-24 rounded-2xl border border-dashed border-border" data-testid="empty-events">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
              <Camera className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-serif text-2xl font-bold mb-2">No events yet</h2>
            <p className="text-muted-foreground mb-6">Create your first event to get a QR code your guests can scan.</p>
            <Button onClick={() => setShowCreate(true)} data-testid="button-create-first-event">
              Create event
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => {
              const cfg = statusConfig[event.status] ?? statusConfig.upcoming;
              const Icon = cfg.icon;
              return (
                <button
                  key={event.id}
                  className="w-full text-left rounded-2xl border border-border bg-card p-6 hover:shadow-md transition-all group flex items-center gap-5"
                  onClick={() => setLocation(`/host/events/${event.id}`)}
                  data-testid={`card-event-${event.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="font-serif text-xl font-bold truncate">{event.title}</h2>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${cfg.className}`}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                    </div>
                    {event.description && (
                      <p className="text-muted-foreground text-sm mb-3 line-clamp-1">{event.description}</p>
                    )}
                    <div className="flex items-center gap-5 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {format(new Date(event.eventDate), "MMM d, yyyy")}
                      </span>
                      <span className="flex items-center gap-1.5" data-testid={`text-guest-count-${event.id}`}>
                        <Users className="w-3.5 h-3.5" />
                        {event.guestCount} {event.guestCount === 1 ? "guest" : "guests"}
                      </span>
                      <span className="flex items-center gap-1.5" data-testid={`text-media-count-${event.id}`}>
                        <Image className="w-3.5 h-3.5" />
                        {event.mediaCount} {event.mediaCount === 1 ? "item" : "items"}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* Create Event Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-create-event">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">New event</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Event name</Label>
              <Input
                id="title"
                placeholder="Emily & James Wedding"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                data-testid="input-event-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Share the details..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                data-testid="input-event-description"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eventDate">Event date & time</Label>
              <Input
                id="eventDate"
                type="datetime-local"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                required
                data-testid="input-event-date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endTime">End time (optional)</Label>
              <Input
                id="endTime"
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                data-testid="input-event-end-time"
              />
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={createEvent.isPending} data-testid="button-submit-create-event">
                {createEvent.isPending ? "Creating..." : "Create event"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
