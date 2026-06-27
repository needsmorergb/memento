import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
  boolean,
  pgEnum,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "free",
  "pro",
  "vendor",
]);

export const mediaTypeEnum = pgEnum("media_type", [
  "photo",
  "video",
  "voice_note",
]);

export const videoJobStatusEnum = pgEnum("video_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const eventStatusEnum = pgEnum("event_status", [
  "upcoming",
  "live",
  "ended",
]);

// ─── Users ───────────────────────────────────────────────────────────────────

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: varchar("clerk_id", { length: 255 }).unique().notNull(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  displayName: varchar("display_name", { length: 255 }),
  avatarUrl: text("avatar_url"),
  isVendor: boolean("is_vendor").default(false).notNull(),
  vendorBusinessName: varchar("vendor_business_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export const selectUserSchema = createSelectSchema(usersTable);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// ─── Subscriptions ────────────────────────────────────────────────────────────

export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id),
  tier: subscriptionTierEnum("tier").default("free").notNull(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  status: varchar("status", { length: 50 }).default("active").notNull(),
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const insertSubscriptionSchema = createInsertSchema(
  subscriptionsTable,
).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;

// ─── Vendor Codes (Referral Codes) ────────────────────────────────────────────
// Vendor-owned referral codes that guests present when joining an event.
// Granting vendor_benefit=true on the event_guest record and a 180s video cap.
// This table fulfills both the "vendor_codes" and "referral_codes" requirements
// in a single entity — each vendor owns one or more codes they distribute.

export const vendorCodesTable = pgTable("vendor_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id),
  code: varchar("code", { length: 50 }).unique().notNull(),
  benefitDescription: text("benefit_description"),
  videoDurationCapSeconds: integer("video_duration_cap_seconds")
    .default(180)
    .notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

/** Alias — same table, surfaced as "referral codes" in guest-facing contexts */
export const referralCodesTable = vendorCodesTable;

export const insertVendorCodeSchema = createInsertSchema(
  vendorCodesTable,
).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true });
export type InsertVendorCode = z.infer<typeof insertVendorCodeSchema>;
export type VendorCode = typeof vendorCodesTable.$inferSelect;

// ─── Events ───────────────────────────────────────────────────────────────────

export const eventsTable = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  hostId: uuid("host_id")
    .notNull()
    .references(() => usersTable.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  eventDate: timestamp("event_date").notNull(),
  endTime: timestamp("end_time"),
  shareToken: varchar("share_token", { length: 64 }).unique().notNull(),
  status: eventStatusEnum("status").default("upcoming").notNull(),
  coverImagePath: text("cover_image_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const insertEventSchema = createInsertSchema(eventsTable).omit({
  id: true,
  shareToken: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export const selectEventSchema = createSelectSchema(eventsTable);
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof eventsTable.$inferSelect;

// ─── Event Guests ─────────────────────────────────────────────────────────────

export const eventGuestsTable = pgTable("event_guests", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id),
  userId: uuid("user_id").references(() => usersTable.id),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  guestToken: varchar("guest_token", { length: 128 }).unique().notNull(),
  pushToken: text("push_token"),
  vendorCodeId: uuid("vendor_code_id").references(() => vendorCodesTable.id),
  vendorBenefit: boolean("vendor_benefit").default(false).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const insertEventGuestSchema = createInsertSchema(
  eventGuestsTable,
).omit({ id: true, guestToken: true, joinedAt: true, deletedAt: true });
export type InsertEventGuest = z.infer<typeof insertEventGuestSchema>;
export type EventGuest = typeof eventGuestsTable.$inferSelect;

// ─── Media Items ──────────────────────────────────────────────────────────────

export const mediaItemsTable = pgTable("media_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id),
  guestId: uuid("guest_id").references(() => eventGuestsTable.id),
  uploaderId: uuid("uploader_id").references(() => usersTable.id),
  mediaType: mediaTypeEnum("media_type").notNull(),
  objectPath: text("object_path").notNull(),
  fileName: varchar("file_name", { length: 255 }),
  fileSizeBytes: integer("file_size_bytes"),
  durationSeconds: integer("duration_seconds"),
  thumbnailPath: text("thumbnail_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const insertMediaItemSchema = createInsertSchema(mediaItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export type InsertMediaItem = z.infer<typeof insertMediaItemSchema>;
export type MediaItem = typeof mediaItemsTable.$inferSelect;

// ─── Video Jobs ───────────────────────────────────────────────────────────────

export const videoJobsTable = pgTable("video_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id),
  tier: subscriptionTierEnum("tier").default("free").notNull(),
  durationCapSeconds: integer("duration_cap_seconds").default(60).notNull(),
  qualityCap: varchar("quality_cap", { length: 10 }).default("720p").notNull(),
  maxResolutionPx: integer("max_resolution_px").default(1280).notNull(),
  status: videoJobStatusEnum("status").default("pending").notNull(),
  videoObjectPath: text("video_object_path"),
  videoUrl: text("video_url"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const insertVideoJobSchema = createInsertSchema(videoJobsTable).omit({
  id: true,
  status: true,
  videoObjectPath: true,
  videoUrl: true,
  errorMessage: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export type InsertVideoJob = z.infer<typeof insertVideoJobSchema>;
export type VideoJob = typeof videoJobsTable.$inferSelect;
