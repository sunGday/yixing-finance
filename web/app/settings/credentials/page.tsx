import type { Metadata } from "next";
import { CredentialsView } from "./view";

export const metadata: Metadata = { title: "收入渠道凭证 · 翊行财务" };

export default function Page() {
  return <CredentialsView />;
}
