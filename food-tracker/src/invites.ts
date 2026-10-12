// Invites: an admin adds someone's email to the Cloudflare Access policy that
// says who may sign in (the one `npm run access` manages), from the Goals tab.
// Nothing else is needed: the person signs in with that email and sets up
// their own profile. Who is an admin comes from ADMIN_EMAILS; the key that may
// edit the policy is the Worker secret ACCESS_INVITE_TOKEN, scoped to
// Access: Apps and Policies.
import { Hono, type Context } from "hono";
import { isAdmin } from "./admins";
import type { AppEnv } from "./env";
import { readJson } from "./profile";
import { isObject } from "./validate";

/** The policy scripts/cloudflare.mjs creates. */
export const ALLOWED_POLICY = "Food Tracker: allowed people";
/** SPEC section 1: family and friends, under 50 people. */
export const MAX_PEOPLE = 50;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ctx = Context<AppEnv>;
type CfFetch = typeof fetch;

class InviteError extends Error {
  constructor(
    readonly status: 502 | 503,
    message: string,
  ) {
    super(message);
  }
}

interface Policy {
  id: string;
  name: string;
  decision: string;
  include: Record<string, unknown>[];
  exclude?: unknown[];
  require?: unknown[];
  session_duration?: string;
}

/** Cloudflare's API, for the Access policy only. Never logs or returns the key. */
async function cloudflare<T>(cf: CfFetch, token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await cf(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new InviteError(502, "We couldn't reach Cloudflare. Try again in a minute.");
  }
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T };
  if (!res.ok || json.success === false) {
    console.error("access policy call failed", method, path.replace(/\/[0-9a-f]{32}\//, "/<account>/"), res.status);
    const denied = res.status === 401 || res.status === 403;
    throw new InviteError(denied ? 503 : 502, denied ? "The invite key can't change who signs in. Check its permissions." : "Cloudflare didn't take that. Try again in a minute.");
  }
  return json.result as T;
}

async function allowedPolicy(c: Ctx, cf: CfFetch): Promise<{ token: string; base: string; policy: Policy }> {
  const token = c.env.ACCESS_INVITE_TOKEN;
  const account = c.env.CF_ACCOUNT_ID;
  if (!token || !account) throw new InviteError(503, "Invites need one more setup step: a Cloudflare key for them. Ask Claude to finish it.");
  const base = `/accounts/${account}/access/policies`;
  const policies = await cloudflare<Policy[]>(cf, token, "GET", base);
  const policy = policies.find((p) => p.name === ALLOWED_POLICY);
  if (!policy) throw new InviteError(503, `Couldn't find the "${ALLOWED_POLICY}" policy in Cloudflare.`);
  return { token, base, policy };
}

const emailsOf = (policy: Policy) =>
  policy.include.flatMap((rule) => {
    const email = (rule.email as { email?: unknown } | undefined)?.email;
    return typeof email === "string" ? [email.toLowerCase()] : [];
  });

export function inviteRoutes(deps: { cfFetch: CfFetch }) {
  const routes = new Hono<AppEnv>();

  const forbidden = (c: Ctx) => c.json({ error: "forbidden", message: "Only the app's owner can invite people." }, 403);
  const failed = (c: Ctx, err: unknown) => {
    if (err instanceof InviteError) return c.json({ error: "invites_unavailable", message: err.message }, err.status);
    throw err;
  };

  // Who can sign in, for the Goals tab.
  routes.get("/people", async (c) => {
    if (!isAdmin(c.env, c.get("email"))) return forbidden(c);
    try {
      const { policy } = await allowedPolicy(c, deps.cfFetch);
      return c.json({ people: emailsOf(policy) });
    } catch (err) {
      return failed(c, err);
    }
  });

  // Let one more person sign in. Saying the same email twice is fine.
  routes.post("/invites", async (c) => {
    if (!isAdmin(c.env, c.get("email"))) return forbidden(c);
    const body = await readJson(c);
    const email = isObject(body) && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254) {
      return c.json({ error: "invalid_input", message: "That doesn't look like an email.", fields: { email: "That doesn't look like an email." } }, 400);
    }
    try {
      const { token, base, policy } = await allowedPolicy(c, deps.cfFetch);
      const people = emailsOf(policy);
      if (people.includes(email)) return c.json({ email, added: false, people });
      if (people.length >= MAX_PEOPLE) {
        return c.json({ error: "too_many", message: `The app is for up to ${MAX_PEOPLE} people.` }, 400);
      }
      const updated = await cloudflare<Policy>(deps.cfFetch, token, "PUT", `${base}/${policy.id}`, {
        name: policy.name,
        decision: policy.decision,
        include: [...policy.include, { email: { email } }],
        exclude: policy.exclude ?? [],
        require: policy.require ?? [],
        session_duration: policy.session_duration ?? "720h",
      });
      return c.json({ email, added: true, people: emailsOf(updated) }, 201);
    } catch (err) {
      return failed(c, err);
    }
  });

  return routes;
}
