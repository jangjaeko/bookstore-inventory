"use client";

import { useEffect, useState } from "react";
import { fmtDateTime } from "@/lib/format";
import type { BookDTO, StockLogDTO } from "@/lib/types";
import { Button, Modal } from "./ui";

export default function LogDialog({
  book,
  onClose,
}: {
  book: BookDTO | null;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<StockLogDTO[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    setLoading(true);
    setLogs([]);
    (async () => {
      try {
        const res = await fetch(`/api/books/${book.id}/logs`);
        const data = await res.json();
        if (!cancelled && res.ok) setLogs(data.logs ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book]);

  return (
    <Modal
      open={book !== null}
      onClose={onClose}
      title={book ? `입출고 이력 · ${book.title}` : "입출고 이력"}
      footer={
        <Button variant="ghost" onClick={onClose}>
          닫기
        </Button>
      }
    >
      <div className="max-h-84 overflow-auto">
        {loading ? (
          <p className="py-6 text-center text-xs text-gray-400">불러오는 중…</p>
        ) : logs.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">기록된 이력이 없습니다.</p>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="flex items-baseline gap-2.5 border-b border-gray-100 px-1 py-2 text-xs">
              <span
                className={`min-w-11 font-bold ${l.delta > 0 ? "text-green-700" : "text-red-600"}`}
              >
                {l.delta > 0 ? "+" : ""}
                {l.delta}
              </span>
              <span>
                {l.reason} <span className="text-gray-400">→ {l.qtyAfter}권</span>
              </span>
              <span className="ml-auto whitespace-nowrap text-gray-400">{fmtDateTime(l.createdAt)}</span>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
