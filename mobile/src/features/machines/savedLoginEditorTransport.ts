import { z } from "zod";
import {
  MachineReviewRequired,
  savedLoginSchema,
  type SavedLogin,
} from "./machineContracts";
import { ApiError } from "../../lib/api/ApiError";

const reviewAccounts = new Set<string>();
export const savedLoginReviewRequired = (userId: string) =>
  reviewAccounts.has(userId);
export const savedLoginReviewed = (userId: string) => {
  reviewAccounts.delete(userId);
};
export class SavedLoginOutcomeUnknown extends Error {}

const exactOrigin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      !url.hostname.includes("*")
    );
  } catch {
    return false;
  }
}, "Use exact HTTPS origins without a path or wildcard.");
export const savedLoginInputSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    allowed_origins: z.array(exactOrigin).min(1).max(16),
    username: z.string().min(1).max(1024),
    password: z.string().max(16384),
    totp_secret: z.string().max(4096),
    confirm_each_sign_in: z.boolean(),
  })
  .strict();
export type SavedLoginInput = z.infer<typeof savedLoginInputSchema>;
type Request = (
  path: string,
  options: {
    method: "GET" | "POST" | "PUT";
    body?: unknown;
    signal?: AbortSignal;
    authorityGuard?: () => void;
  },
) => Promise<unknown>;
const ownerSchema = z
  .object({
    orgs: z.array(
      z.object({
        id: z.string().uuid(),
        your_role: z.string(),
        display_name: z.string().nullish(),
        slug: z.string(),
      }),
    ),
  })
  .transform(({ orgs }) => orgs.filter((org) => org.your_role === "admin"));

export function createSavedLoginEditorApi(request: Request) {
  return {
    async owners(signal?: AbortSignal) {
      return ownerSchema.parse(
        await request("/orgs", { method: "GET", signal }),
      );
    },
    async save(
      input: SavedLoginInput,
      ownerId: string,
      userId: string,
      current: () => boolean,
      prior?: SavedLogin,
    ) {
      let body:
        | {
            label: string;
            allowed_origins: string[];
            username: string;
            password: string | null;
            totp_secret: string | null;
            confirm_each_sign_in: boolean;
          }
        | undefined;
      let dispatched = false;
      const guard = () => {
        if (!current())
          throw new MachineReviewRequired(
            "Your login editing context changed. Refresh and review again.",
          );
      };
      try {
        guard();
        z.string().uuid().parse(ownerId);
        const parsed = savedLoginInputSchema.parse(input);
        body = {
          ...parsed,
          password: parsed.password || null,
          totp_secret: parsed.totp_secret || null,
        };
        if (ownerId !== userId) {
          const orgs = ownerSchema.parse(
            await request("/orgs", { method: "GET", authorityGuard: guard }),
          );
          if (!orgs.some((org) => org.id === ownerId))
            throw new MachineReviewRequired(
              "Organization Admin access is no longer available. Refresh before saving.",
            );
        }
        if (prior) {
          const rows = savedLoginSchema
            .array()
            .parse(
              await request(
                `/saved-logins?owner_id=${encodeURIComponent(ownerId)}`,
                { method: "GET", authorityGuard: guard },
              ),
            );
          const latest = rows.find((row) => row.id === prior.id);
          if (
            !latest ||
            latest.owner_id !== ownerId ||
            latest.updated_at !== prior.updated_at
          )
            throw new MachineReviewRequired(
              "This login changed. Refresh and review it before replacing credentials.",
            );
        }
        guard();
        const path = prior
          ? `/saved-logins/${encodeURIComponent(prior.id)}`
          : `/saved-logins?owner_id=${encodeURIComponent(ownerId)}`;
        dispatched = true;
        reviewAccounts.add(userId);
        const result = savedLoginSchema.parse(
          await request(path, {
            method: prior ? "PUT" : "POST",
            body,
            authorityGuard: guard,
          }),
        );
        if (!current())
          throw new SavedLoginOutcomeUnknown(
            "The save may have reached the server. Refresh saved-login metadata before editing again.",
          );
        if (result.owner_id !== ownerId || (prior && result.id !== prior.id))
          throw new MachineReviewRequired(
            "The saved login did not match the selected owner. Refresh before continuing.",
          );
        reviewAccounts.delete(userId);
        return result;
      } catch (cause) {
        if (dispatched) {
          if (
            cause instanceof ApiError &&
            cause.statusCode >= 400 &&
            cause.statusCode < 500
          )
            reviewAccounts.delete(userId);
          else
            throw new SavedLoginOutcomeUnknown(
              "The save may have reached the server. Refresh saved-login metadata before editing again.",
            );
        }
        throw cause;
      } finally {
        // Secrets are passed directly to transport, never Query mutation variables.
        input.username = "";
        input.password = "";
        input.totp_secret = "";
        if (body) {
          body.username = "";
          body.password = null;
          body.totp_secret = null;
        }
      }
    },
  };
}
