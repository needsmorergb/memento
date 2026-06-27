import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetVendorReferralCode,
  useRegisterVendor,
  useGetMe,
  getGetVendorReferralCodeQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, CheckCircle, Store, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function VendorPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me, isLoading: meLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: codeInfo, isLoading: codeLoading } = useGetVendorReferralCode({
    query: {
      enabled: !!me?.isVendor,
      queryKey: getGetVendorReferralCodeQueryKey(),
    },
  });

  const registerVendor = useRegisterVendor();
  const [businessName, setBusinessName] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!businessName) return;
    registerVendor.mutate(
      { data: { businessName } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetVendorReferralCodeQueryKey() });
          toast({ title: "Vendor account created!" });
        },
        onError: () => toast({ title: "Registration failed", variant: "destructive" }),
      }
    );
  }

  function copyCode() {
    if (!codeInfo?.code) return;
    navigator.clipboard.writeText(codeInfo.code).then(() => {
      setCopiedCode(true);
      toast({ title: "Code copied" });
      setTimeout(() => setCopiedCode(false), 2000);
    });
  }

  function copyLink() {
    if (!codeInfo?.joinUrl) return;
    navigator.clipboard.writeText(codeInfo.joinUrl).then(() => {
      setCopiedLink(true);
      toast({ title: "Join link copied" });
      setTimeout(() => setCopiedLink(false), 2000);
    });
  }

  const capSeconds = codeInfo?.videoDurationCapSeconds ?? 180;
  const capLabel = `${Math.floor(capSeconds / 60)}:${String(capSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/host")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="font-serif text-lg font-bold">Vendor portal</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {meLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        ) : !me?.isVendor ? (
          /* Registration form */
          <div>
            <div className="text-center mb-10">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
                <Store className="w-7 h-7 text-primary" />
              </div>
              <h2 className="font-serif text-3xl font-bold mb-3">Become a vendor</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                As a photographer, wedding planner, or event vendor, get your own referral link to give clients extended video edits.
              </p>
            </div>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="font-serif text-lg">Vendor benefits</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {[
                    "Your own referral code and shareable join link",
                    "Clients using your link get extended video edits (default 3 minutes vs 60 seconds free)",
                    "Your branding shown on the guest join page",
                    "Priority video processing for your clients",
                  ].map((benefit) => (
                    <li key={benefit} className="flex items-start gap-2.5 text-sm">
                      <CheckCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      {benefit}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-lg">Register your business</CardTitle>
                <CardDescription>Enter your business name to get your referral link</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="businessName">Business name</Label>
                    <Input
                      id="businessName"
                      placeholder="Jane Smith Photography"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      required
                      data-testid="input-business-name"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={registerVendor.isPending} data-testid="button-register-vendor">
                    {registerVendor.isPending ? "Registering..." : "Register as vendor"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Vendor dashboard */
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Store className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-serif text-2xl font-bold">{me.vendorBusinessName ?? "Your Business"}</h2>
                <Badge variant="outline" className="text-xs mt-0.5" data-testid="badge-vendor">Vendor account</Badge>
              </div>
            </div>

            {codeLoading ? (
              <Skeleton className="h-48 rounded-2xl" />
            ) : codeInfo ? (
              <>
                {/* Referral code */}
                <Card>
                  <CardHeader>
                    <CardTitle className="font-serif text-lg">Your referral code</CardTitle>
                    <CardDescription>
                      Guests who use this code (or your join link) get an extended video edit — up to {capLabel}.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="flex items-center gap-3" data-testid="card-referral-code">
                      <div className="flex-1 bg-muted rounded-xl px-5 py-4 text-center">
                        <span className="text-3xl font-bold font-mono tracking-widest text-primary" data-testid="text-referral-code">
                          {codeInfo.code}
                        </span>
                      </div>
                      <Button variant="outline" size="icon" onClick={copyCode} data-testid="button-copy-code">
                        {copiedCode ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-xl border border-border bg-muted/30 p-4 text-center">
                        <div className="text-2xl font-bold text-primary mb-1" data-testid="text-video-cap">
                          {capLabel}
                        </div>
                        <div className="text-xs text-muted-foreground">Video cap for clients</div>
                      </div>
                      <div className="rounded-xl border border-border bg-muted/30 p-4 text-center">
                        <div className="text-2xl font-bold mb-1" data-testid="text-code-status">Active</div>
                        <div className="text-xs text-muted-foreground">Code status</div>
                      </div>
                    </div>

                    {codeInfo.benefitDescription && (
                      <p className="text-sm text-muted-foreground border-t border-border pt-4">
                        {codeInfo.benefitDescription}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Join link */}
                <Card>
                  <CardHeader>
                    <CardTitle className="font-serif text-lg">Your vendor join link</CardTitle>
                    <CardDescription>
                      Share this link with clients. It pre-fills your code automatically — guests just enter their name and join.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3" data-testid="card-join-link">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-lg px-3 py-2.5 text-sm font-mono text-muted-foreground truncate" data-testid="text-join-url">
                        {codeInfo.joinUrl}
                      </div>
                      <Button variant="outline" size="icon" onClick={copyLink} data-testid="button-copy-link">
                        {copiedLink ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </Button>
                      <a href={codeInfo.joinUrl} target="_blank" rel="noopener noreferrer" data-testid="link-open-join-url">
                        <Button variant="outline" size="icon">
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </a>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This link contains your code. Guests who open it will automatically have your referral applied.
                    </p>
                  </CardContent>
                </Card>

                {/* How to guide */}
                <Card>
                  <CardHeader>
                    <CardTitle className="font-serif text-lg">How to use your link</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
                      <li>Share your join link (above) with your client before or at the event</li>
                      <li>Guests who open your link automatically get your vendor code applied</li>
                      <li>Their same-day edit will be up to {capLabel} long</li>
                      <li>Your branding appears on the join page so guests know you arranged it</li>
                    </ol>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="text-center py-10 text-muted-foreground">
                  <Store className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>Your referral code is being generated...</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
