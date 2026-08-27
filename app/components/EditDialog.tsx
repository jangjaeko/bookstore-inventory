"use client";

import { useEffect, useState } from "react";
import type { BookDTO } from "@/lib/types";
import { Button, Field, Modal } from "./ui";

type Form = {
  title: string;
  isbn: string;
  qty: string;
  author: string;
  publisher: string;
  pubDate: string;
  krw: string;
  cad: string;
  weight: string;
  location: string;
  subject: string;
  memo: string;
};

const EMPTY: Form = {
  title: "", isbn: "", qty: "1", author: "", publisher: "", pubDate: "",
  krw: "", cad: "", weight: "", location: "", subject: "", memo: "",
};

const s = (v: string | null | undefined) => v ?? "";
const n = (v: number | null | undefined) => (v == null ? "" : String(v));

export default function EditDialog({
  open,
  book,
  onClose,
  onDone,
}: {
  open: boolean;
  book: BookDTO | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(
      book
        ? {
            title: s(book.title),
            isbn: s(book.isbn),
            qty: String(book.qty),
            author: s(book.author),
            publisher: s(book.publisher),
            pubDate: s(book.pubDate),
            krw: n(book.krw),
            cad: n(book.cad),
            weight: n(book.weight),
            location: s(book.location),
            subject: s(book.subject),
            memo: s(book.memo),
          }
        : EMPTY,
    );
  }, [open, book]);

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save() {
    if (!form.title.trim()) {
      setError("도서명은 반드시 입력해야 합니다.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = { ...form, qty: Math.max(0, Math.round(Number(form.qty) || 0)) };
      const res = await fetch(book ? `/api/books/${book.id}` : "/api/books", {
        method: book ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");

      onDone(
        book
          ? "수정했습니다"
          : data.merged
            ? `이미 있는 책이라 수량을 ${payload.qty}권 더했습니다`
            : "등록했습니다",
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={book ? "도서 수정" : "도서 추가"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? "저장 중…" : "저장"}
          </Button>
        </>
      }
    >
      <div
        className="grid grid-cols-2 gap-x-3.5 gap-y-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy) void save();
        }}
      >
        <Field label="도서명" required className="col-span-2" value={form.title} onChange={set("title")} autoFocus />
        <Field label="ISBN" placeholder="9791130681887" value={form.isbn} onChange={set("isbn")} />
        <Field label="수량" type="number" value={form.qty} onChange={set("qty")} />
        <Field label="저자" className="col-span-2" value={form.author} onChange={set("author")} />
        <Field label="출판사" value={form.publisher} onChange={set("publisher")} />
        <Field label="출간(YYYYMM)" placeholder="202607" value={form.pubDate} onChange={set("pubDate")} />
        <Field label="정가 (₩)" type="number" value={form.krw} onChange={set("krw")} />
        <Field label="판매가 (CAD)" type="number" step="0.5" value={form.cad} onChange={set("cad")} />
        <Field label="무게 (g)" type="number" value={form.weight} onChange={set("weight")} />
        <Field label="위치 / 서가" placeholder="A-3" value={form.location} onChange={set("location")} />
        <Field label="Subject (분류)" className="col-span-2" value={form.subject} onChange={set("subject")} />
        <Field label="메모" className="col-span-2" value={form.memo} onChange={set("memo")} />
      </div>

      {error && <p className="mt-3 text-xs font-medium text-red-600">{error}</p>}
    </Modal>
  );
}
