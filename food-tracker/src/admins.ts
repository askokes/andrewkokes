/** People who may invite others (Worker var ADMIN_EMAILS, comma separated). */
export function isAdmin(env: { ADMIN_EMAILS?: string }, email: string): boolean {
  const admins = (env.ADMIN_EMAILS ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}
