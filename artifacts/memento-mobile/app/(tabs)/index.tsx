import { Feather } from "@expo/vector-icons";
import { useAuth, useClerk, useUser } from "@clerk/expo";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import {
  useGetMySubscription,
  getGetMySubscriptionQueryKey,
} from "@workspace/api-client-react";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;

function tierLabel(tier: string | undefined) {
  if (tier === "vendor") return "Vendor";
  if (tier === "pro") return "Pro";
  return "Free";
}

function tierColor(tier: string | undefined, colors: ReturnType<typeof useColors>) {
  if (tier === "vendor") return "#7c3aed";
  if (tier === "pro") return colors.primary;
  return colors.mutedForeground;
}

interface PriceRow {
  price_id: string;
  product_id: string;
  product_name: string;
  unit_amount: number;
  currency: string;
  recurring: { interval: string; interval_count?: number } | null;
  product_metadata: Record<string, string> | null;
}

function formatAmount(unitAmount: number, currency: string): string {
  const amount = unitAmount / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function SubscriptionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { isSignedIn, getToken, signOut } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();

  const [showSignInForm, setShowSignInForm] = React.useState(false);
  const [signInEmail, setSignInEmail] = React.useState("");
  const [signInPassword, setSignInPassword] = React.useState("");
  const [authLoading, setAuthLoading] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [upgradeLoading, setUpgradeLoading] = React.useState(false);
  const [portalLoading, setPortalLoading] = React.useState(false);

  const [showPlanPicker, setShowPlanPicker] = React.useState(false);
  const [prices, setPrices] = React.useState<PriceRow[]>([]);
  const [pricesLoading, setPricesLoading] = React.useState(false);
  const [selectedInterval, setSelectedInterval] = React.useState<"monthly" | "annual">("monthly");

  const { data: mySub, isLoading: subLoading } = useGetMySubscription({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { queryKey: getGetMySubscriptionQueryKey(), enabled: !!isSignedIn } as any,
  });

  const subTier = mySub?.tier;
  const isPaid = subTier === "pro" || subTier === "vendor";
  const hostEmail = user?.emailAddresses?.[0]?.emailAddress;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  const fetchPrices = React.useCallback(async () => {
    setPricesLoading(true);
    try {
      const baseUrl = DOMAIN ? `https://${DOMAIN}` : "";
      const res = await fetch(`${baseUrl}/api/billing/prices`);
      if (res.ok) {
        const data = await res.json() as { prices: PriceRow[] };
        const proPrices = (data.prices ?? []).filter(
          (p) => p.product_metadata?.tier === "pro"
        );
        setPrices(proPrices);
      }
    } catch {
      // silently fall back — user can still proceed with defaults
    } finally {
      setPricesLoading(false);
    }
  }, []);

  const monthlyPrice = prices.find((p) => p.recurring?.interval === "month");
  const annualPrice = prices.find((p) => p.recurring?.interval === "year");

  const annualSavingsPct = React.useMemo(() => {
    if (!monthlyPrice || !annualPrice) return null;
    const monthlyTotal = monthlyPrice.unit_amount * 12;
    const saving = Math.round((1 - annualPrice.unit_amount / monthlyTotal) * 100);
    return saving > 0 ? saving : null;
  }, [monthlyPrice, annualPrice]);

  const handleClerkSignIn = async () => {
    if (!clerk.client) {
      setAuthError("Authentication service not ready. Please try again.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientAny = clerk.client as any;
      const result = await clientAny.signIn.create({
        identifier: signInEmail.trim(),
        password: signInPassword,
      });
      if (result?.status === "complete") {
        await clerk.setActive({ session: result.createdSessionId });
      }
      setShowSignInForm(false);
      setSignInEmail("");
      setSignInPassword("");
    } catch (e: unknown) {
      setAuthError(
        e instanceof Error
          ? e.message
          : "Sign-in failed. Check your email and password."
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const openPlanPicker = () => {
    if (!isSignedIn) {
      setShowSignInForm(true);
      return;
    }
    setSelectedInterval("monthly");
    setShowPlanPicker(true);
    fetchPrices();
  };

  const handleUpgrade = async () => {
    setShowPlanPicker(false);
    setUpgradeLoading(true);
    try {
      const token = await getToken();
      const baseUrl = DOMAIN ? `https://${DOMAIN}` : "";
      const res = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({ plan: "pro", interval: selectedInterval }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Could not start checkout");
      }
      const { url } = await res.json() as { url: string };
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not open checkout");
    } finally {
      setUpgradeLoading(false);
    }
  };

  const handleManagePortal = async () => {
    setPortalLoading(true);
    try {
      const token = await getToken();
      const baseUrl = DOMAIN ? `https://${DOMAIN}` : "";
      const res = await fetch(`${baseUrl}/api/billing/portal`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Could not open portal");
      }
      const { url } = await res.json() as { url: string };
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not open portal");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.background, paddingTop: topPad },
      ]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: botPad + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerSection}>
          <Text
            style={[
              styles.screenTitle,
              { color: colors.foreground, fontFamily: "Outfit_700Bold" },
            ]}
          >
            Account
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: isSignedIn ? "#bbf7d0" : colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <View
              style={[
                styles.iconWrap,
                {
                  backgroundColor: isSignedIn
                    ? "#dcfce7"
                    : colors.primary + "15",
                },
              ]}
            >
              <Feather
                name={isSignedIn ? "check-circle" : "lock"}
                size={16}
                color={isSignedIn ? "#16a34a" : colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.rowLabel,
                  { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
                ]}
              >
                Host Account
              </Text>
              <Text
                style={[
                  styles.rowValue,
                  {
                    color: isSignedIn ? "#15803d" : colors.foreground,
                    fontFamily: "Outfit_500Medium",
                  },
                ]}
              >
                {isSignedIn
                  ? hostEmail ?? "Signed in"
                  : "Sign in to manage your subscription"}
              </Text>
            </View>
            {isSignedIn && (
              <TouchableOpacity
                onPress={() => signOut()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={[
                    styles.linkText,
                    {
                      color: colors.mutedForeground,
                      fontFamily: "Outfit_400Regular",
                    },
                  ]}
                >
                  Sign out
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {!isSignedIn && (
            <>
              <TouchableOpacity
                style={styles.signInToggle}
                onPress={() => setShowSignInForm((v) => !v)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.signInToggleText,
                    { color: colors.primary, fontFamily: "Outfit_500Medium" },
                  ]}
                >
                  {showSignInForm ? "Hide sign-in form" : "Sign in as host →"}
                </Text>
              </TouchableOpacity>

              {showSignInForm && (
                <View
                  style={[
                    styles.signInForm,
                    { borderTopColor: colors.border },
                  ]}
                >
                  {authError && (
                    <View
                      style={[
                        styles.authErrorBox,
                        { backgroundColor: colors.destructive + "15" },
                      ]}
                    >
                      <Text
                        style={[
                          styles.authErrorText,
                          {
                            color: colors.destructive,
                            fontFamily: "Outfit_400Regular",
                          },
                        ]}
                      >
                        {authError}
                      </Text>
                    </View>
                  )}
                  <TextInput
                    style={[
                      styles.input,
                      {
                        borderColor: colors.border,
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderRadius: colors.radius,
                        fontFamily: "Outfit_400Regular",
                      },
                    ]}
                    placeholder="Email"
                    placeholderTextColor={colors.mutedForeground}
                    value={signInEmail}
                    onChangeText={setSignInEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                  />
                  <TextInput
                    style={[
                      styles.input,
                      {
                        borderColor: colors.border,
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderRadius: colors.radius,
                        fontFamily: "Outfit_400Regular",
                      },
                    ]}
                    placeholder="Password"
                    placeholderTextColor={colors.mutedForeground}
                    value={signInPassword}
                    onChangeText={setSignInPassword}
                    secureTextEntry
                    autoComplete="password"
                  />
                  <TouchableOpacity
                    style={[
                      styles.signInBtn,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                        opacity: authLoading ? 0.6 : 1,
                      },
                    ]}
                    onPress={handleClerkSignIn}
                    disabled={authLoading}
                    activeOpacity={0.8}
                  >
                    {authLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text
                        style={[
                          styles.signInBtnText,
                          { fontFamily: "Outfit_600SemiBold" },
                        ]}
                      >
                        Sign In
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {isSignedIn && (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.foreground, fontFamily: "Outfit_600SemiBold" },
              ]}
            >
              Subscription
            </Text>

            {subLoading ? (
              <ActivityIndicator
                color={colors.primary}
                style={{ marginVertical: 16 }}
              />
            ) : (
              <>
                <View
                  style={[
                    styles.tierBadgeRow,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <View
                    style={[
                      styles.iconWrap,
                      {
                        backgroundColor: isPaid
                          ? colors.primary + "20"
                          : colors.muted,
                      },
                    ]}
                  >
                    <Feather
                      name={isPaid ? "star" : "user"}
                      size={16}
                      color={tierColor(subTier, colors)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.rowLabel,
                        {
                          color: colors.mutedForeground,
                          fontFamily: "Outfit_400Regular",
                        },
                      ]}
                    >
                      Current plan
                    </Text>
                    <Text
                      style={[
                        styles.rowValue,
                        {
                          color: tierColor(subTier, colors),
                          fontFamily: "Outfit_600SemiBold",
                        },
                      ]}
                    >
                      {tierLabel(subTier)}
                    </Text>
                  </View>
                  {mySub?.currentPeriodEnd && isPaid && (
                    <Text
                      style={[
                        styles.renewalText,
                        {
                          color: colors.mutedForeground,
                          fontFamily: "Outfit_400Regular",
                        },
                      ]}
                    >
                      Renews{" "}
                      {new Date(mySub.currentPeriodEnd).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" }
                      )}
                    </Text>
                  )}
                </View>

                {!isPaid && (
                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                        opacity: upgradeLoading ? 0.6 : 1,
                      },
                    ]}
                    onPress={openPlanPicker}
                    disabled={upgradeLoading}
                    activeOpacity={0.8}
                  >
                    {upgradeLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Feather name="zap" size={16} color="#fff" />
                        <Text
                          style={[
                            styles.actionBtnText,
                            { fontFamily: "Outfit_600SemiBold" },
                          ]}
                        >
                          Upgrade to Pro
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                {isPaid && (
                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: colors.primary + "15",
                        borderRadius: colors.radius,
                        borderWidth: 1,
                        borderColor: colors.primary + "40",
                        opacity: portalLoading ? 0.6 : 1,
                      },
                    ]}
                    onPress={handleManagePortal}
                    disabled={portalLoading}
                    activeOpacity={0.8}
                  >
                    {portalLoading ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <>
                        <Feather name="settings" size={16} color={colors.primary} />
                        <Text
                          style={[
                            styles.actionBtnText,
                            {
                              fontFamily: "Outfit_600SemiBold",
                              color: colors.primary,
                            },
                          ]}
                        >
                          Manage Subscription
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* Plan Picker Modal */}
      <Modal
        visible={showPlanPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPlanPicker(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowPlanPicker(false)}
        >
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: botPad + 16,
                borderRadius: colors.radius * 2,
              },
            ]}
            onPress={() => {}}
          >
            <View style={styles.sheetHandle} />

            <Text
              style={[
                styles.sheetTitle,
                { color: colors.foreground, fontFamily: "Outfit_700Bold" },
              ]}
            >
              Choose your plan
            </Text>
            <Text
              style={[
                styles.sheetSubtitle,
                { color: colors.mutedForeground, fontFamily: "Outfit_400Regular" },
              ]}
            >
              Save money with annual billing
            </Text>

            {pricesLoading ? (
              <ActivityIndicator
                color={colors.primary}
                style={{ marginVertical: 24 }}
              />
            ) : (
              <View style={styles.planOptions}>
                {/* Monthly option */}
                <TouchableOpacity
                  style={[
                    styles.planOption,
                    {
                      borderColor:
                        selectedInterval === "monthly"
                          ? colors.primary
                          : colors.border,
                      backgroundColor:
                        selectedInterval === "monthly"
                          ? colors.primary + "10"
                          : colors.background,
                      borderRadius: colors.radius,
                    },
                  ]}
                  onPress={() => setSelectedInterval("monthly")}
                  activeOpacity={0.8}
                >
                  <View style={styles.planOptionLeft}>
                    <View
                      style={[
                        styles.radio,
                        {
                          borderColor:
                            selectedInterval === "monthly"
                              ? colors.primary
                              : colors.border,
                        },
                      ]}
                    >
                      {selectedInterval === "monthly" && (
                        <View
                          style={[
                            styles.radioDot,
                            { backgroundColor: colors.primary },
                          ]}
                        />
                      )}
                    </View>
                    <View>
                      <Text
                        style={[
                          styles.planName,
                          {
                            color: colors.foreground,
                            fontFamily: "Outfit_600SemiBold",
                          },
                        ]}
                      >
                        Monthly
                      </Text>
                      <Text
                        style={[
                          styles.planBilling,
                          {
                            color: colors.mutedForeground,
                            fontFamily: "Outfit_400Regular",
                          },
                        ]}
                      >
                        Billed every month
                      </Text>
                    </View>
                  </View>
                  <View style={styles.planOptionRight}>
                    {monthlyPrice ? (
                      <Text
                        style={[
                          styles.planPrice,
                          {
                            color: colors.foreground,
                            fontFamily: "Outfit_700Bold",
                          },
                        ]}
                      >
                        {formatAmount(monthlyPrice.unit_amount, monthlyPrice.currency)}
                        <Text
                          style={[
                            styles.planPricePer,
                            {
                              color: colors.mutedForeground,
                              fontFamily: "Outfit_400Regular",
                            },
                          ]}
                        >
                          /mo
                        </Text>
                      </Text>
                    ) : (
                      <Text
                        style={[
                          styles.planPrice,
                          {
                            color: colors.mutedForeground,
                            fontFamily: "Outfit_400Regular",
                          },
                        ]}
                      >
                        —
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>

                {/* Annual option */}
                <TouchableOpacity
                  style={[
                    styles.planOption,
                    {
                      borderColor:
                        selectedInterval === "annual"
                          ? colors.primary
                          : colors.border,
                      backgroundColor:
                        selectedInterval === "annual"
                          ? colors.primary + "10"
                          : colors.background,
                      borderRadius: colors.radius,
                    },
                  ]}
                  onPress={() => setSelectedInterval("annual")}
                  activeOpacity={0.8}
                >
                  <View style={styles.planOptionLeft}>
                    <View
                      style={[
                        styles.radio,
                        {
                          borderColor:
                            selectedInterval === "annual"
                              ? colors.primary
                              : colors.border,
                        },
                      ]}
                    >
                      {selectedInterval === "annual" && (
                        <View
                          style={[
                            styles.radioDot,
                            { backgroundColor: colors.primary },
                          ]}
                        />
                      )}
                    </View>
                    <View>
                      <View style={styles.planNameRow}>
                        <Text
                          style={[
                            styles.planName,
                            {
                              color: colors.foreground,
                              fontFamily: "Outfit_600SemiBold",
                            },
                          ]}
                        >
                          Annual
                        </Text>
                        {annualSavingsPct !== null && (
                          <View
                            style={[
                              styles.savingsBadge,
                              { backgroundColor: "#dcfce7" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.savingsText,
                                { fontFamily: "Outfit_600SemiBold" },
                              ]}
                            >
                              Save {annualSavingsPct}%
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.planBilling,
                          {
                            color: colors.mutedForeground,
                            fontFamily: "Outfit_400Regular",
                          },
                        ]}
                      >
                        Billed once per year
                      </Text>
                    </View>
                  </View>
                  <View style={styles.planOptionRight}>
                    {annualPrice ? (
                      <>
                        <Text
                          style={[
                            styles.planPrice,
                            {
                              color: colors.foreground,
                              fontFamily: "Outfit_700Bold",
                            },
                          ]}
                        >
                          {formatAmount(
                            Math.round(annualPrice.unit_amount / 12),
                            annualPrice.currency
                          )}
                          <Text
                            style={[
                              styles.planPricePer,
                              {
                                color: colors.mutedForeground,
                                fontFamily: "Outfit_400Regular",
                              },
                            ]}
                          >
                            /mo
                          </Text>
                        </Text>
                        <Text
                          style={[
                            styles.planPriceTotal,
                            {
                              color: colors.mutedForeground,
                              fontFamily: "Outfit_400Regular",
                            },
                          ]}
                        >
                          {formatAmount(annualPrice.unit_amount, annualPrice.currency)}/yr
                        </Text>
                      </>
                    ) : (
                      <Text
                        style={[
                          styles.planPrice,
                          {
                            color: colors.mutedForeground,
                            fontFamily: "Outfit_400Regular",
                          },
                        ]}
                      >
                        —
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.continueBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  marginHorizontal: 20,
                  marginTop: 20,
                  opacity: pricesLoading ? 0.6 : 1,
                },
              ]}
              onPress={handleUpgrade}
              disabled={pricesLoading}
              activeOpacity={0.8}
            >
              <Feather name="zap" size={16} color="#fff" />
              <Text
                style={[styles.continueBtnText, { fontFamily: "Outfit_600SemiBold" }]}
              >
                Continue with {selectedInterval === "annual" ? "Annual" : "Monthly"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setShowPlanPicker(false)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.cancelBtnText,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Outfit_400Regular",
                  },
                ]}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  headerSection: {
    paddingVertical: 8,
  },
  screenTitle: {
    fontSize: 28,
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionTitle: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  rowValue: {
    fontSize: 14,
  },
  linkText: {
    fontSize: 13,
  },
  signInToggle: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  signInToggleText: {
    fontSize: 14,
  },
  signInForm: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  authErrorBox: {
    borderRadius: 8,
    padding: 10,
  },
  authErrorText: {
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  signInBtn: {
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  signInBtnText: {
    color: "#fff",
    fontSize: 15,
  },
  tierBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  renewalText: {
    fontSize: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    margin: 16,
    paddingVertical: 13,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    paddingTop: 12,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 20,
    textAlign: "center",
    marginBottom: 4,
  },
  sheetSubtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
  },
  planOptions: {
    paddingHorizontal: 20,
    gap: 10,
  },
  planOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderWidth: 2,
  },
  planOptionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  planOptionRight: {
    alignItems: "flex-end",
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  planNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  planName: {
    fontSize: 15,
  },
  planBilling: {
    fontSize: 12,
    marginTop: 2,
  },
  savingsBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savingsText: {
    fontSize: 11,
    color: "#15803d",
  },
  planPrice: {
    fontSize: 16,
  },
  planPricePer: {
    fontSize: 12,
  },
  planPriceTotal: {
    fontSize: 11,
    marginTop: 2,
  },
  continueBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  continueBtnText: {
    color: "#fff",
    fontSize: 15,
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 4,
  },
  cancelBtnText: {
    fontSize: 14,
  },
});
