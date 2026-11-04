/** Pure credential-contract helpers. No field-key lists, no secret values, no filesystem. */

export const CREDENTIALS_HREF = "/settings/credentials";

export const CRED_RETRY_FLAG = "yx-revenue-cred-retry";

/** Shown when a save reached the API but /revenues is still a credential gap. */
export const API_PERSIST_NOTE =
  "凭证已经交给财务 API。收入要等服务端完成持久化并热加载后才会成功。若这里仍是凭证缺失，需要 mario 让 API 进程读到新凭证。";

export type FieldInput = "text" | "password";

export type FieldSchema = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  input: FieldInput;
};

export type ChannelSchema = {
  id: string;
  label: string;
  fields: FieldSchema[];
};

export type FieldSource = "file" | "env" | "none";

export type FieldStatus = {
  key: string;
  set: boolean;
  hint?: string;
  source?: FieldSource;
  overriddenByEnv?: boolean;
  /** Short status label from the API, when it sent one. */
  statusText?: string;
  /** Only for schema fields with secret:false. Never filled for secrets. */
  value?: string;
};

export type SecretStorage = {
  dir?: string;
  file?: string;
  exists?: boolean;
  encrypted?: boolean;
  loadError?: string;
};

export type ChannelStatus = {
  id: string;
  configured: boolean;
  statusText?: string;
  fields: FieldStatus[];
};

const CHANNEL_ID = /^[A-Za-z0-9_-]+$/;
const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HINT_MAX = 64;
const VALUE_MAX = 256;

export function isCredentialGap(err: {
  message?: string;
  code?: number;
  gapFlags?: string[];
  gap_flags?: string[];
} | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 50301) return true;
  if (typeof err.message === "string" && err.message.includes("CredentialMissing")) return true;
  const flags = err.gapFlags ?? err.gap_flags;
  return !!flags?.some((flag) => flag.startsWith("credential_missing"));
}

export function isCredentialsUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === 404 || code === 40401) return true;
  const message = err instanceof Error ? err.message : "";
  return /\b404\b/.test(message) || /not found/i.test(message);
}

export function markRevenueCredRetry() {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(CRED_RETRY_FLAG, "1"); } catch { /* private mode */ }
}

export function takeRevenueCredRetry(): boolean {
  if (typeof window === "undefined") return false;
  try { return sessionStorage.getItem(CRED_RETRY_FLAG) === "1"; } catch { return false; }
}

export function clearRevenueCredRetry() {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(CRED_RETRY_FLAG); } catch { /* private mode */ }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function schemaRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const channels = (data as { channels?: unknown }).channels;
  return Array.isArray(channels) ? channels : [];
}

export function normalizeSchema(data: unknown): ChannelSchema[] {
  const out: ChannelSchema[] = [];
  const seen = new Set<string>();
  for (const row of schemaRows(data)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: unknown; label?: unknown; fields?: unknown };
    const id = text(rec.id);
    if (!CHANNEL_ID.test(id) || seen.has(id) || !Array.isArray(rec.fields)) continue;
    const fields: FieldSchema[] = [];
    const keys = new Set<string>();
    for (const item of rec.fields) {
      if (!item || typeof item !== "object") continue;
      const field = item as { key?: unknown; label?: unknown; secret?: unknown; required?: unknown; input?: unknown };
      const key = text(field.key);
      if (!FIELD_KEY.test(key) || keys.has(key)) continue;
      const secret = field.secret === true;
      keys.add(key);
      fields.push({
        key,
        label: text(field.label) || key,
        secret,
        required: field.required !== false,
        input: field.input === "password" || secret ? "password" : "text",
      });
    }
    if (!fields.length) continue;
    seen.add(id);
    out.push({ id, label: text(rec.label) || id, fields });
  }
  return out;
}

function statusRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const rec = data as { channels?: unknown; items?: unknown; channel?: unknown; id?: unknown; fields?: unknown };
  if (Array.isArray(rec.channels)) return rec.channels;
  if (Array.isArray(rec.items)) return rec.items;
  if ((text(rec.channel) || text(rec.id)) && rec.fields) return [data];
  return [];
}

function lookupField(rawFields: unknown, key: string): unknown {
  if (Array.isArray(rawFields)) {
    return rawFields.find((item) => !!item && typeof item === "object" && text((item as { key?: unknown }).key) === key);
  }
  if (rawFields && typeof rawFields === "object") return (rawFields as Record<string, unknown>)[key];
  return undefined;
}

function safeHint(hint: unknown, value: string | undefined): string | undefined {
  if (typeof hint !== "string") return undefined;
  const trimmed = hint.trim();
  if (!trimmed || trimmed.length > HINT_MAX || /[\r\n\0]/.test(trimmed)) return undefined;
  if (value && trimmed === value) return undefined;
  return trimmed;
}

function fieldSource(value: unknown): FieldSource | undefined {
  if (value === "file" || value === "env" || value === "none") return value;
  return undefined;
}

function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\r\n\0]/.test(trimmed)) return undefined;
  return trimmed;
}

function readField(field: FieldSchema, raw: unknown): FieldStatus {
  if (typeof raw === "boolean") return { key: field.key, set: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { key: field.key, set: false };
  const rec = raw as { set?: unknown; hint?: unknown; value?: unknown; source?: unknown; overridden_by_env?: unknown; status?: unknown };
  const value = typeof rec.value === "string" ? rec.value : undefined;
  const hint = safeHint(rec.hint, value);
  const source = fieldSource(rec.source);
  const set = typeof rec.set === "boolean"
    ? rec.set
    : source === "none"
      ? false
      : source === "file" || source === "env"
        ? true
        : !!value && value.trim().length > 0;
  const status: FieldStatus = { key: field.key, set };
  if (hint) status.hint = hint;
  if (source) status.source = source;
  if (rec.overridden_by_env === true) status.overriddenByEnv = true;
  const statusText = shortText(rec.status, 32);
  if (statusText && statusText !== value) status.statusText = statusText;
  if (!field.secret && value && value.trim() && value.length <= VALUE_MAX && !/[\r\n\0]/.test(value)) {
    status.value = value;
  }
  return status;
}

export function readStorage(data: unknown): SecretStorage | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as { storage?: unknown }).storage;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as { dir?: unknown; file?: unknown; exists?: unknown; encrypted?: unknown; load_error?: unknown };
  const storage: SecretStorage = {};
  const dir = shortText(rec.dir, 200);
  const file = shortText(rec.file, 200);
  if (dir) storage.dir = dir;
  if (file) storage.file = file;
  if (typeof rec.exists === "boolean") storage.exists = rec.exists;
  if (typeof rec.encrypted === "boolean") storage.encrypted = rec.encrypted;
  const loadError = shortText(rec.load_error, 180);
  if (loadError) storage.loadError = loadError;
  return storage;
}

export function channelReady(channel: ChannelSchema, status: ChannelStatus | undefined): boolean {
  const required = channel.fields.filter((field) => field.required);
  const watched = required.length ? required : channel.fields;
  return watched.every((field) => status?.fields.find((item) => item.key === field.key)?.set);
}

export function normalizeCredentials(data: unknown, schema: ChannelSchema[]): ChannelStatus[] {
  const byId = new Map<string, { configured?: boolean; statusText?: string; fields?: unknown }>();
  for (const row of statusRows(data)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: unknown; channel?: unknown; configured?: unknown; status?: unknown; fields?: unknown };
    const id = text(rec.id) || text(rec.channel);
    if (!CHANNEL_ID.test(id) || byId.has(id)) continue;
    const statusText = shortText(rec.status, 32);
    const configured = rec.configured === true || statusText === "configured";
    byId.set(id, {
      configured: rec.configured === false ? false : configured,
      statusText,
      fields: rec.fields,
    });
  }
  return schema.map((channel) => {
    const raw = byId.get(channel.id);
    const fields = channel.fields.map((field) => readField(field, lookupField(raw?.fields, field.key)));
    const derived = channelReady(channel, { id: channel.id, configured: false, fields });
    return {
      id: channel.id,
      configured: raw ? raw.configured === true : derived,
      statusText: raw?.statusText,
      fields,
    };
  });
}

export function changedFields(
  fields: { key: string }[],
  drafts: Record<string, string>,
  dirty: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (!dirty.has(field.key)) continue;
    out[field.key] = (drafts[field.key] ?? "").trim();
  }
  return out;
}

export function fullFields(fields: { key: string }[], drafts: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) out[field.key] = (drafts[field.key] ?? "").trim();
  return out;
}

export function fieldStatus(status: ChannelStatus | undefined, key: string): FieldStatus | undefined {
  return status?.fields.find((item) => item.key === key);
}
