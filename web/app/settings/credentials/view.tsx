"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Banner, Empty, Panel } from "@/components/fin/ui";
import { PageSkeleton } from "@/components/fin/page-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadError } from "@/lib/errors";
import {
  type ChannelSchema,
  type ChannelStatus,
  type FieldSchema,
  changedFields,
  channelReady,
  fieldStatus,
  fullFields,
  isCredentialsUnavailable,
  markRevenueCredRetry,
} from "@/lib/credentials";
import { keptHref, useQueryString } from "@/lib/url-state";

const FIXTURES = process.env.NEXT_PUBLIC_FINANCE_MODE === "fixtures";

type Mode = "patch" | "put" | "delete";

export function CredentialsView() {
  const router = useRouter();
  const search = useQueryString();
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(!FIXTURES);
  const [unavailable, setUnavailable] = useState(false);
  const [schema, setSchema] = useState<ChannelSchema[]>([]);
  const [statuses, setStatuses] = useState<ChannelStatus[]>([]);
  const [storage, setStorage] = useState<import("@/lib/credentials").SecretStorage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tone, setTone] = useState<"info" | "warning">("info");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (FIXTURES) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const api = await import("@/lib/credentials-api");
        const nextSchema = await api.fetchCredentialSchema();
        if (cancel) return;
        let nextStatus: ChannelStatus[] = [];
        let statusMissing = false;
        try {
          const listed = await api.fetchCredentials(nextSchema);
          nextStatus = listed.channels;
          if (!cancel) setStorage(listed.storage);
        } catch (err) {
          if (!isCredentialsUnavailable(err)) throw err;
          statusMissing = true;
          nextStatus = nextSchema.map((channel) => ({
            id: channel.id,
            configured: false,
            fields: channel.fields.map((field) => ({ key: field.key, set: false })),
          }));
        }
        if (cancel) return;
        setSchema(nextSchema);
        setStatuses(nextStatus);
        setUnavailable(false);
        if (!nextSchema.length) {
          setTone("info");
          setNotice("schema 里还没有渠道。");
        } else if (statusMissing) {
          setTone("warning");
          setNotice("schema 已返回。状态接口还没有数据，字段先按未配置显示。");
        }
      } catch (err) {
        if (cancel) return;
        if (isCredentialsUnavailable(err)) {
          setUnavailable(true);
          setSchema([]);
        } else {
          setTone("warning");
          setNotice(err instanceof LoadError ? err.message : "读取凭证接口失败");
        }
      } finally {
        if (!cancel) {
          setLoading(false);
          setBusy(false);
        }
      }
    })();
    return () => { cancel = true; };
  }, [tick]);

  async function reload() {
    setTick((n) => n + 1);
  }

  async function write(id: string, mode: Mode, fields: Record<string, string>, retry: boolean) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const api = await import("@/lib/credentials-api");
      if (mode === "delete") await api.deleteCredentialChannel(id);
      else if (mode === "put") await api.putCredentialChannel(id, fields);
      else await api.patchCredentialChannel(id, fields);
      setTone("info");
      setNotice(mode === "delete" ? "已删除该渠道凭证。密钥不会回显。" : "已提交到财务 API。密钥不会回显。");
      if (retry) {
        markRevenueCredRetry();
        router.push(keptHref("/revenues", search));
        return;
      }
      setTick((n) => n + 1);
    } catch (err) {
      setTone("warning");
      if (isCredentialsUnavailable(err)) setNotice("财务 API 还没有这个写入接口。存储和热加载由 mario 实现。");
      else setNotice(err instanceof LoadError ? err.message : "保存失败");
      setBusy(false);
    }
  }

  if (FIXTURES) {
    return (
      <Frame search={search}>
        <Empty title="静态演示没有凭证接口" reason="GitHub Pages 不连接财务 API。请在本机 next dev 打开 /settings/credentials。" />
      </Frame>
    );
  }

  return (
    <Frame search={search}>
      <Banner tone="info">
        渠道和字段来自 GET /api/v1/credentials/schema。保存使用 PATCH（只提交改过的项，空字符串会清除）或 PUT（覆盖该渠道）。密钥只显示掩码提示。
      </Banner>
      {storage ? <StorageLine storage={storage} /> : null}
      {loading ? <PageSkeleton /> : null}
      {!loading && unavailable ? (
        <Empty
          title="财务 API 还没有凭证接口"
          reason="约定路径：GET /api/v1/credentials/schema、GET /api/v1/credentials、GET/PUT/PATCH/DELETE /api/v1/credentials/{channel}。存储和热加载由 mario 继续做。"
        />
      ) : null}
      {!loading && !unavailable && schema.length === 0 ? <Empty title="没有可录入的渠道" reason="schema 的 channels 为空。" /> : null}
      {!loading && !unavailable ? schema.map((channel) => (
        <ChannelEditor
          key={channel.id}
          channel={channel}
          status={statuses.find((row) => row.id === channel.id)}
          disabled={busy}
          onWrite={(mode, fields, retry) => write(channel.id, mode, fields, retry)}
        />
      )) : null}
      {notice ? <div role="status"><Banner tone={tone}>{notice}</Banner></div> : null}
      {!loading ? <Button type="button" variant="outline" className="h-9 self-start" onClick={() => void reload()}>重新读取</Button> : null}
    </Frame>
  );
}

function Frame({ search, children }: { search: string; children: React.ReactNode }) {
  return (
    <div className="px-3 md:px-4 py-3 flex flex-col gap-3 max-w-3xl">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">收入渠道凭证</h1>
          <p className="text-xs text-muted-foreground mt-0.5">按财务 API schema 录入 · 密钥不回显</p>
        </div>
        <Link href={keptHref("/revenues", search)} className="shrink-0 text-xs text-brand">返回收入流水</Link>
      </div>
      {children}
    </div>
  );
}

function draftsFrom(channel: ChannelSchema, status: ChannelStatus | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of channel.fields) {
    const current = fieldStatus(status, field.key);
    out[field.key] = field.secret ? "" : (current?.value ?? "");
  }
  return out;
}

function ChannelEditor({
  channel, status, disabled, onWrite,
}: {
  channel: ChannelSchema;
  status: ChannelStatus | undefined;
  disabled: boolean;
  onWrite: (mode: Mode, fields: Record<string, string>, retry: boolean) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState(() => draftsFrom(channel, status));
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<"put" | "delete" | null>(null);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const ready = channelReady(channel, status);

  useEffect(() => {
    setDrafts(draftsFrom(channel, status));
    setDirty({});
    setConfirm(null);
    setLocalNote(null);
  }, [channel, status]);

  function edit(key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => ({ ...prev, [key]: true }));
    setConfirm(null);
    setLocalNote(null);
  }

  async function save(retry: boolean) {
    const fields = changedFields(channel.fields, drafts, new Set(Object.keys(dirty).filter((key) => dirty[key])));
    if (!Object.keys(fields).length) {
      setLocalNote("没有改动。未改过的字段不会提交；点清除后再保存，才会把该字段清成空字符串。");
      return;
    }
    await onWrite("patch", fields, retry);
  }

  return (
    <Panel title={channel.label} extra={<span className="mono">{channel.id}</span>}>
      <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{ready ? "已配齐" : "未配齐"} · {channel.fields.length} 个字段</span>
        <span>{channelStatusLabel(status)}</span>
      </div>
      <div className="grid gap-3">
        {channel.fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            status={fieldStatus(status, field.key)}
            value={drafts[field.key] ?? ""}
            disabled={disabled}
            onChange={(value) => edit(field.key, value)}
            onClear={() => edit(field.key, "")}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" className="h-9" disabled={disabled} onClick={() => void save(false)}>保存</Button>
        <Button type="button" variant="outline" className="h-9" disabled={disabled} onClick={() => void save(true)}>保存并重试收入</Button>
        <Button type="button" variant="outline" className="h-9" disabled={disabled} onClick={() => setConfirm(confirm === "put" ? null : "put")}>
          {confirm === "put" ? "再点一次覆盖" : "覆盖保存"}
        </Button>
        <Button type="button" variant="ghost" className="h-9" disabled={disabled} onClick={() => setConfirm(confirm === "delete" ? null : "delete")}>
          {confirm === "delete" ? "再点一次删除" : "删除本渠道"}
        </Button>
      </div>
      {confirm === "put" ? (
        <div className="mt-2">
          <Button type="button" variant="outline" className="h-9" disabled={disabled} onClick={() => void onWrite("put", fullFields(channel.fields, drafts), false)}>
            确认覆盖，空白字段会被清空
          </Button>
        </div>
      ) : null}
      {confirm === "delete" ? (
        <div className="mt-2">
          <Button type="button" variant="destructive" className="h-9" disabled={disabled} onClick={() => void onWrite("delete", {}, false)}>
            确认删除本渠道凭证
          </Button>
        </div>
      ) : null}
      {localNote ? <p className="mt-2 text-[11px] text-muted-foreground">{localNote}</p> : null}
    </Panel>
  );
}

function FieldRow({
  field, status, value, disabled, onChange, onClear,
}: {
  field: FieldSchema;
  status: { set: boolean; hint?: string; source?: string; overriddenByEnv?: boolean; statusText?: string } | undefined;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const configured = !!status?.set;
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2 text-xs">
        <span>{field.label} <span className="mono text-muted-foreground">{field.key}</span>{field.required ? "" : " · 选填"}</span>
        <span className={configured ? "text-success" : "text-muted-foreground"}>{configured ? "已配置" : "未配置"}</span>
      </span>
      <span className="text-[11px] text-muted-foreground">
        {sourceLabel(status?.source)}
        {status?.overriddenByEnv ? " · 环境变量覆盖文件" : ""}
        {status?.hint ? <span className="mono"> · 提示 {status.hint}</span> : null}
      </span>
      <span className="flex gap-1.5">
        <Input
          name={field.key}
          type={field.input === "password" ? "password" : "text"}
          value={value}
          disabled={disabled}
          autoComplete={field.secret ? "new-password" : "off"}
          spellCheck={false}
          placeholder={configured ? "已配置。要清除请点清除后再保存" : "未配置"}
          className="h-9 bg-surface font-mono text-sm"
          onChange={(event) => onChange(event.target.value)}
        />
        <Button type="button" variant="outline" className="h-9 shrink-0" disabled={disabled} onClick={onClear}>清除</Button>
      </span>
    </label>
  );
}

function sourceLabel(source: string | undefined): string {
  if (source === "file") return "来源 文件";
  if (source === "env") return "来源 环境变量";
  if (source === "none") return "来源 无";
  return "来源 —";
}

function channelStatusLabel(status: ChannelStatus | undefined): string {
  if (status?.statusText === "configured") return "状态 已配齐";
  if (status?.statusText === "partial") return "状态 部分配置";
  if (status?.statusText === "missing") return "状态 未配置";
  return status?.configured ? "状态 已配置" : "状态 未配置";
}

function StorageLine({ storage }: { storage: import("@/lib/credentials").SecretStorage }) {
  const bits = [
    storage.dir ? `目录 ${storage.dir}` : "",
    storage.file ? `文件 ${storage.file}` : "",
    storage.exists === true ? "文件已存在" : storage.exists === false ? "文件未创建" : "",
    storage.encrypted === true ? "已加密" : storage.encrypted === false ? "未加密" : "",
    storage.loadError ? `读取错误 ${storage.loadError}` : "",
  ].filter(Boolean);
  if (!bits.length) return null;
  return <p className="text-[11px] text-muted-foreground">{bits.join(" · ")}</p>;
}
