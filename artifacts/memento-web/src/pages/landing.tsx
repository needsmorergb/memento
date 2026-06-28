import { useLocation } from "wouter";
import { Camera, Heart, Film, QrCode, Users, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="fixed top-0 inset-x-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <Camera className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-serif text-xl font-bold tracking-tight">Momento</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => setLocation("/sign-in")} data-testid="button-sign-in">
              Sign in
            </Button>
            <Button onClick={() => setLocation("/sign-up")} data-testid="button-get-started">
              Host an event
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium mb-8">
            <Heart className="w-3.5 h-3.5" />
            <span>For weddings, parties & every milestone</span>
          </div>
          <h1 className="font-serif text-5xl md:text-7xl font-bold leading-[1.1] tracking-tight mb-8">
            Every memory,
            <br />
            <span className="text-primary">together in one place</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
            Guests scan a QR code and instantly contribute photos, videos, and voice notes to a shared stream. When the event ends, we compile everything into a cinematic same-day edit.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              className="text-base px-8"
              onClick={() => setLocation("/sign-up")}
              data-testid="button-create-event"
            >
              Create your event
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-base px-8"
              onClick={() => setLocation("/sign-in")}
              data-testid="button-already-have-account"
            >
              I already have an account
            </Button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 bg-card border-y border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-serif text-4xl font-bold mb-4">How it works</h2>
            <p className="text-muted-foreground text-lg">Three simple steps to a shared memory</p>
          </div>
          <div className="grid md:grid-cols-3 gap-10">
            {[
              {
                icon: QrCode,
                step: "01",
                title: "Create your event",
                description: "Set up your event in minutes. We generate a unique QR code your guests can scan to join instantly.",
              },
              {
                icon: Share2,
                step: "02",
                title: "Guests contribute",
                description: "Everyone uploads photos, videos, and voice notes directly to the shared event feed — no app download required.",
              },
              {
                icon: Film,
                step: "03",
                title: "Same-day edit delivered",
                description: "When the event ends, our system compiles the best moments into a beautifully edited video delivered to all guests.",
              },
            ].map(({ icon: Icon, step, title, description }) => (
              <div key={step} className="text-center" data-testid={`card-step-${step}`}>
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                  <Icon className="w-7 h-7 text-primary" />
                </div>
                <div className="text-xs font-bold text-primary tracking-widest uppercase mb-2">{step}</div>
                <h3 className="font-serif text-xl font-bold mb-3">{title}</h3>
                <p className="text-muted-foreground leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-serif text-4xl font-bold mb-4">Built for the moments that matter</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              { icon: QrCode, title: "Instant QR join", description: "Print or display the QR code. Guests join in one tap, no account required." },
              { icon: Users, title: "Shared live feed", description: "Watch photos and videos appear in real-time as guests contribute throughout the event." },
              { icon: Film, title: "Same-day edit video", description: "A cinematic highlight reel compiled automatically from all guest contributions." },
              { icon: Heart, title: "Voice notes", description: "Capture heartfelt messages and toasts, not just photos. These become the soul of your edit." },
            ].map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="flex gap-5 p-6 rounded-2xl border border-border bg-card hover:shadow-md transition-shadow"
                data-testid={`card-feature-${title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1.5">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 px-6 bg-card border-y border-border">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-serif text-4xl font-bold mb-4">Simple pricing</h2>
            <p className="text-muted-foreground text-lg">Start free, upgrade when you need more</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                name: "Free",
                price: "$0",
                description: "Perfect for trying it out",
                features: ["1 event", "Unlimited guests", "60 second edit video", "QR join code"],
                cta: "Get started free",
                featured: false,
              },
              {
                name: "Pro Host",
                price: "$29",
                description: "For serious celebrations",
                features: ["Unlimited events", "Unlimited guests", "5 minute edit video", "QR join code", "Priority processing"],
                cta: "Start with Pro",
                featured: true,
              },
              {
                name: "Vendor",
                price: "$99/mo",
                description: "For photographers & planners",
                features: ["Everything in Pro", "Referral codes for clients", "3 minute guest videos", "Vendor dashboard", "Priority support"],
                cta: "Become a vendor",
                featured: false,
              },
            ].map(({ name, price, description, features, cta, featured }) => (
              <div
                key={name}
                className={`rounded-2xl p-8 border ${featured ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
                data-testid={`card-pricing-${name.toLowerCase()}`}
              >
                <div className="mb-6">
                  <h3 className="font-serif text-xl font-bold mb-1">{name}</h3>
                  <div className="text-3xl font-bold mb-1">{price}</div>
                  <p className={`text-sm ${featured ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{description}</p>
                </div>
                <ul className="space-y-3 mb-8">
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${featured ? "bg-primary-foreground/20" : "bg-primary/10"}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${featured ? "bg-primary-foreground" : "bg-primary"}`} />
                      </div>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={featured ? "secondary" : "default"}
                  onClick={() => setLocation("/sign-up")}
                  data-testid={`button-pricing-${name.toLowerCase()}`}
                >
                  {cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="py-24 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-serif text-4xl font-bold mb-4">Ready to capture everything?</h2>
          <p className="text-muted-foreground text-lg mb-8">Create your event in under 2 minutes. Your guests will thank you.</p>
          <Button size="lg" className="text-base px-10" onClick={() => setLocation("/sign-up")} data-testid="button-footer-cta">
            Create your first event
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
              <Camera className="w-3 h-3 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">Momento</span>
          </div>
          <p>Memories made permanent.</p>
        </div>
      </footer>
    </div>
  );
}
