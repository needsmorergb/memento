import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, eventGuestsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export interface AuthenticatedRequest extends Request {
  dbUser?: typeof usersTable.$inferSelect;
  guestRecord?: typeof eventGuestsTable.$inferSelect;
}

/**
 * Resolves the current Clerk user to a DB user record (JIT provisioning).
 * Creates the user record if it doesn't exist yet.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, userId),
  });

  if (!user) {
    const email =
      (sessionClaims?.email as string) ||
      (sessionClaims?.primary_email as string) ||
      "";
    const displayName =
      (sessionClaims?.name as string) ||
      (sessionClaims?.full_name as string) ||
      "";

    [user] = await db
      .insert(usersTable)
      .values({ clerkId: userId, email, displayName })
      .returning();
  }

  req.dbUser = user;
  next();
}

/**
 * Tries both Clerk auth and guest token. Sets dbUser and/or guestRecord if found.
 * Does NOT reject the request — access enforcement is done downstream.
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  // Try Clerk auth
  const { userId } = getAuth(req);
  if (userId) {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, userId),
    });
    if (user) req.dbUser = user;
  }

  // Try guest token
  const guestToken = req.headers["x-guest-token"] as string | undefined;
  if (guestToken) {
    const guest = await db.query.eventGuestsTable.findFirst({
      where: eq(eventGuestsTable.guestToken, guestToken),
    });
    if (guest) req.guestRecord = guest;
  }

  next();
}

/**
 * Optional guest auth via X-Guest-Token header. Attaches guestRecord if valid.
 */
export async function optionalGuestAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const guestToken = req.headers["x-guest-token"] as string | undefined;
  if (guestToken) {
    const guest = await db.query.eventGuestsTable.findFirst({
      where: eq(eventGuestsTable.guestToken, guestToken),
    });
    if (guest) {
      req.guestRecord = guest;
    }
  }
  next();
}

/**
 * Requires a valid guest token in the X-Guest-Token header.
 */
export async function requireGuestAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const guestToken = req.headers["x-guest-token"] as string | undefined;
  if (!guestToken) {
    res.status(401).json({ error: "Guest token required" });
    return;
  }

  const guest = await db.query.eventGuestsTable.findFirst({
    where: eq(eventGuestsTable.guestToken, guestToken),
  });

  if (!guest) {
    res.status(401).json({ error: "Invalid guest token" });
    return;
  }

  req.guestRecord = guest;
  next();
}
