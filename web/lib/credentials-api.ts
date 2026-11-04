import { apiSend } from "./api-client";
import { normalizeCredentials, normalizeSchema, readStorage, type ChannelSchema, type ChannelStatus, type SecretStorage } from "./credentials";

// TODO(mario): persistence and hot reload live on the finance API, not in Next.
// Contract (browser → BFF /api/v1, Bearer injected server-side):
//   GET    /credentials/schema
//   GET    /credentials
//   GET    /credentials/{channel}
//   PUT    /credentials/{channel}    { "fields": { [key]: string } }
//   PATCH  /credentials/{channel}    { "fields": { [key]: string } }  // empty string clears
//   DELETE /credentials/{channel}
// Responses must not carry full secrets — only set + masked hint.
// Do not write these values into .env.local or any NEXT_PUBLIC_* key.

const ID = /^[A-Za-z0-9_-]+$/;

function channelPath(id: string): string {
  if (!ID.test(id)) throw new Error("渠道 id 无效");
  return `/credentials/${encodeURIComponent(id)}`;
}

export function fetchCredentialSchema(signal?: AbortSignal): Promise<ChannelSchema[]> {
  return apiSend<unknown>("/credentials/schema", { signal }).then(normalizeSchema);
}

export function fetchCredentials(schema: ChannelSchema[], signal?: AbortSignal): Promise<{ channels: ChannelStatus[]; storage: SecretStorage | null }> {
  return apiSend<unknown>("/credentials", { cache: "no-store", signal }).then((data) => ({
    channels: normalizeCredentials(data, schema),
    storage: readStorage(data),
  }));
}

export function fetchCredentialChannel(schema: ChannelSchema[], id: string): Promise<ChannelStatus | undefined> {
  return apiSend<unknown>(channelPath(id)).then((data) => normalizeCredentials({ channels: [data] }, schema).find((row) => row.id === id));
}

export function putCredentialChannel(id: string, fields: Record<string, string>): Promise<void> {
  return apiSend<unknown>(channelPath(id), { method: "PUT", body: { fields } }).then(() => undefined);
}

export function patchCredentialChannel(id: string, fields: Record<string, string>): Promise<void> {
  return apiSend<unknown>(channelPath(id), { method: "PATCH", body: { fields } }).then(() => undefined);
}

export function deleteCredentialChannel(id: string): Promise<void> {
  return apiSend<unknown>(channelPath(id), { method: "DELETE" }).then(() => undefined);
}
