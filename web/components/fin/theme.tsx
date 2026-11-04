"use client";

import { cn } from "@/lib/utils";

/** 文案由 .dark 控制显隐，避免和本地主题偏好产生 hydration 不一致。 */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="切换深色主题"
      className={cn(className)}
      onClick={() => {
        const next = !document.documentElement.classList.contains("dark");
        document.documentElement.classList.toggle("dark", next);
        try { localStorage.setItem("yx-theme", next ? "dark" : "light"); } catch { /* 隐私模式忽略 */ }
      }}
    >
      <span className="dark:hidden">深色</span>
      <span className="hidden dark:inline">浅色</span>
    </button>
  );
}
