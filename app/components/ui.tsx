"use client";

import { useEffect } from "react";

// ─────────────── 버튼 ───────────────
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
};

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50",
  primary: "border border-accent bg-accent text-white hover:brightness-95",
  ghost: "border border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-800",
  danger: "border border-red-200 text-red-600 hover:bg-red-50",
};

export function Button({ variant = "default", size = "md", className = "", ...rest }: ButtonProps) {
  const sizeCls = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2 text-[13px]";
  return (
    <button
      {...rest}
      className={`rounded-lg font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-45 ${sizeCls} ${VARIANTS[variant]} ${className}`}
    />
  );
}

// ─────────────── 모달 ───────────────
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-auto bg-black/45 p-4 sm:p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`mx-auto w-full rounded-xl bg-white shadow-2xl ${wide ? "max-w-5xl" : "max-w-lg"}`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-[15px] font-bold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="px-1 text-xl leading-none text-gray-400 hover:text-gray-700"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 rounded-b-xl border-t border-gray-200 bg-gray-50 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────── 폼 입력 ───────────────
export function Field({
  label,
  required,
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; required?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] font-semibold text-gray-500">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <input
        {...rest}
        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
      />
    </label>
  );
}

export function Select({
  label,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const select = (
    <select
      {...rest}
      className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-accent"
    >
      {children}
    </select>
  );
  if (!label) return select;
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-500">
      {label}
      {select}
    </label>
  );
}
