"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  COPY_FORMATS,
  buildCsv,
  fmtInt,
  subjectDetail,
  subjectGroup,
  type CopyFormatKey,
} from "@/lib/format";
import { isValidIsbn } from "@/lib/parse";
import type { BookDTO, FilterKey, SortKey, Totals } from "@/lib/types";
import { Button, Select } from "./ui";
import ImportDialog from "./ImportDialog";
import EditDialog from "./EditDialog";
import LogDialog from "./LogDialog";

const EMPTY_TOTALS: Totals = { titles: 0, copies: 0, low: 0, zero: 0 };

/** 정렬·보기·부족 기준을 브라우저에 기억시키는 키 (기본값을 바꾸면 뒤 숫자를 올립니다) */
const VIEW_KEY = "bi_view2";

export default function InventoryApp() {
  const router = useRouter();

  const [books, setBooks] = useState<BookDTO[]>([]);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [filter, setFilter] = useState<FilterKey>("all");
  // 부족 기준 기본값 0 = 품절(0권)만 빨갛게, 주황 "부족" 경고는 안 띄웁니다.
  const [threshold, setThreshold] = useState(0);
  /** "" = 전체, "__none__" = 분류 없는 책, 그 밖에는 큰 분류 이름 */
  const [subject, setSubject] = useState("");
  const [subjects, setSubjects] = useState<{ group: string; n: number }[]>([]);
  const [noSubject, setNoSubject] = useState(0);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAmount, setBulkAmount] = useState(1);

  const [importOpen, setImportOpen] = useState(false);
  /** undefined = 닫힘, null = 새로 추가, BookDTO = 수정 */
  const [editing, setEditing] = useState<BookDTO | null | undefined>(undefined);
  const [logFor, setLogFor] = useState<BookDTO | null>(null);

  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  // ── 화면 설정은 브라우저에 기억시킵니다 (재고 데이터는 서버에 있습니다) ──
  // 키 뒤의 숫자는 기본값을 바꿨을 때 올립니다. 예전 키에 저장된 값은 무시되어
  // 모든 브라우저가 새 기본값으로 한 번 초기화됩니다.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}");
      if (saved.sort) setSort(saved.sort);
      if (saved.filter) setFilter(saved.filter);
      if (typeof saved.threshold === "number") setThreshold(saved.threshold);
      if (typeof saved.subject === "string") setSubject(saved.subject);
    } catch {
      /* 저장된 설정이 깨졌으면 기본값 사용 */
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ sort, filter, threshold, subject }));
  }, [sort, filter, threshold, subject]);

  // ── 검색어 디바운스 ──
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // ── 목록 불러오기 ──
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: debouncedQ,
        sort,
        filter,
        threshold: String(threshold),
        subject,
      });
      const res = await fetch(`/api/books?${params}`);
      if (res.status === 401) return router.push("/login");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "목록을 불러오지 못했습니다.");
      setBooks(data.books);
      setTotals(data.totals ?? EMPTY_TOTALS);
      setSubjects(data.subjects ?? []);
      setNoSubject(data.noSubject ?? 0);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, sort, filter, threshold, subject, router, showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── 검색창 단축키 (Ctrl/⌘+K) ──
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── 수량 변경 (화면을 먼저 바꾸고 서버에 반영) ──
  const applyQty = useCallback(
    async (book: BookDTO, body: { delta: number } | { qty: number }) => {
      const optimistic =
        "delta" in body ? Math.max(0, book.qty + body.delta) : Math.max(0, body.qty);
      setBooks((prev) => prev.map((b) => (b.id === book.id ? { ...b, qty: optimistic } : b)));
      try {
        const res = await fetch(`/api/books/${book.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) return router.push("/login");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setBooks((prev) => prev.map((b) => (b.id === book.id ? data.book : b)));
        setTotals((t) => ({ ...t, copies: t.copies + (data.book.qty - book.qty) }));
      } catch (err) {
        showToast(err instanceof Error ? err.message : "수량 변경에 실패했습니다.");
        void refresh();
      }
    },
    [router, showToast, refresh],
  );

  const removeBook = useCallback(
    async (book: BookDTO) => {
      if (!confirm(`"${book.title}" 을(를) 재고에서 삭제할까요?`)) return;
      const res = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
      if (res.status === 401) return router.push("/login");
      if (!res.ok) return showToast("삭제에 실패했습니다.");
      setSelected((s) => {
        const next = new Set(s);
        next.delete(book.id);
        return next;
      });
      showToast("삭제했습니다");
      void refresh();
    },
    [router, showToast, refresh],
  );

  // ── 선택 항목 일괄 처리 ──
  const selectedBooks = useMemo(() => books.filter((b) => selected.has(b.id)), [books, selected]);

  const bulk = useCallback(
    async (body: { action: "delete" } | { delta: number }) => {
      const ids = [...selected];
      if (!ids.length) return;
      if ("action" in body && !confirm(`선택한 ${ids.length}종을 삭제할까요?`)) return;

      const res = await fetch("/api/books", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, ...body }),
      });
      if (res.status === 401) return router.push("/login");
      const data = await res.json();
      if (!res.ok) return showToast(data.error ?? "처리에 실패했습니다.");

      if ("action" in body) {
        setSelected(new Set());
        showToast(`${ids.length}종 삭제`);
      } else {
        showToast(`${data.updated}종 ${body.delta > 0 ? "입고" : "출고"} ${Math.abs(body.delta)}권`);
      }
      void refresh();
    },
    [selected, router, showToast, refresh],
  );

  const copyAs = useCallback(
    async (key: CopyFormatKey) => {
      const fmt = COPY_FORMATS[key];
      const target = selectedBooks.length ? selectedBooks : books;
      if (!target.length) return;
      const text = target.map(fmt.build).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        showToast(`${target.length}종 복사됨 · ${fmt.label} (엑셀에 붙여넣기)`);
      } catch {
        showToast("클립보드 복사에 실패했습니다.");
      }
    },
    [selectedBooks, books, showToast],
  );

  const exportCsv = useCallback(() => {
    const blob = new Blob([buildCsv(books)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, "0");
    a.href = url;
    a.download = `재고_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`${books.length}종 CSV 내보냄`);
  }, [books, showToast]);

  const allChecked = books.length > 0 && books.every((b) => selected.has(b.id));

  return (
    <div className="min-h-screen">
      {/* ───────── 상단 ───────── */}
      <header className="border-b border-gray-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-1.5 text-base font-bold whitespace-nowrap">
            📦 서점 재고 관리
          </h1>

          <div className="relative min-w-60 flex-1">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs opacity-50">
              🔍
            </span>
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="도서명 · ISBN · 저자 · 출판사로 검색 (Ctrl+K)"
              className="w-full rounded-lg border border-gray-200 py-2 pr-3 pl-8 text-[13px] outline-none focus:border-accent"
            />
          </div>

          <Button variant="primary" onClick={() => setImportOpen(true)}>
            📋 엑셀 붙여넣기
          </Button>
          <Button onClick={() => setEditing(null)}>+ 직접 추가</Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              router.push("/login");
            }}
          >
            로그아웃
          </Button>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-4 text-xs text-gray-500">
          <span>
            <b className="mr-0.5 text-[15px] text-gray-900">{fmtInt(totals.titles)}</b>종
          </span>
          <span>
            <b className="mr-0.5 text-[15px] text-gray-900">{fmtInt(totals.copies)}</b>권
          </span>
          <span>
            <b className="mr-0.5 text-[15px] text-orange-700">{fmtInt(totals.low)}</b>종 부족
          </span>
          <span>
            <b className="mr-0.5 text-[15px] text-red-600">{fmtInt(totals.zero)}</b>종 품절
          </span>
          {(debouncedQ || filter !== "all") && (
            <span className="text-accent">
              검색결과 <b className="text-[15px]">{fmtInt(books.length)}</b>종
            </span>
          )}
        </div>
      </header>

      {/* ───────── 도구 모음 ───────── */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-5 py-2.5">
        <Select label="정렬" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="updated">최근 변경순</option>
          <option value="title">도서명순</option>
          <option value="qtyDesc">수량 많은순</option>
          <option value="qtyAsc">수량 적은순</option>
          <option value="added">등록순</option>
        </Select>

        <Select label="보기" value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
          <option value="all">전체</option>
          <option value="inStock">재고 있음</option>
          <option value="low">부족 + 품절</option>
          <option value="zero">품절만</option>
        </Select>

        <Select label="분류" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">전체 분류</option>
          {subjects.map((s) => (
            <option key={s.group} value={s.group}>
              {s.group} ({s.n})
            </option>
          ))}
          {noSubject > 0 && <option value="__none__">분류 없음 ({noSubject})</option>}
        </Select>

        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          부족 기준 ≤
          <input
            type="number"
            min={0}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
            className="w-14 rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] outline-none focus:border-accent"
          />
        </label>

        <span className="mx-1 h-5 w-px bg-gray-200" />
        <Button variant="ghost" onClick={exportCsv} disabled={!books.length}>
          CSV 내보내기
        </Button>
        {loading && <span className="text-xs text-gray-400">불러오는 중…</span>}
      </div>

      {/* ───────── 선택 액션 ───────── */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-blue-200 bg-accent-soft px-5 py-2 text-[13px]">
          <span>
            <b className="text-accent">{selected.size}</b>개 선택됨
          </span>
          <span className="mx-1 h-5 w-px bg-blue-200" />
          <input
            type="number"
            min={1}
            value={bulkAmount}
            onChange={(e) => setBulkAmount(Math.max(1, Number(e.target.value) || 1))}
            className="w-16 rounded-lg border border-blue-200 bg-white px-2 py-1 text-[13px] outline-none focus:border-accent"
          />
          <Button size="sm" onClick={() => bulk({ delta: bulkAmount })}>
            ＋ 입고
          </Button>
          <Button size="sm" onClick={() => bulk({ delta: -bulkAmount })}>
            － 출고
          </Button>
          <span className="mx-1 h-5 w-px bg-blue-200" />
          {(Object.keys(COPY_FORMATS) as CopyFormatKey[]).map((k) => (
            <Button key={k} size="sm" onClick={() => copyAs(k)}>
              {COPY_FORMATS[k].label} 복사
            </Button>
          ))}
          <span className="mx-1 h-5 w-px bg-blue-200" />
          <Button size="sm" variant="danger" onClick={() => bulk({ action: "delete" })}>
            삭제
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            선택 해제
          </Button>
        </div>
      )}

      {/* ───────── 표 ───────── */}
      <main className="px-5 pb-20">
        {books.length === 0 && !loading ? (
          <div className="rounded-b-xl bg-white py-20 text-center text-gray-500">
            <h2 className="mb-1.5 text-[15px] font-bold text-gray-900">
              {debouncedQ ? "검색 결과가 없습니다" : "재고가 비어 있습니다"}
            </h2>
            <p className="text-xs leading-relaxed">
              {debouncedQ ? (
                "다른 검색어로 찾아보세요."
              ) : (
                <>
                  엑셀에서 행을 복사한 뒤 <b>📋 엑셀 붙여넣기</b>를 누르거나,
                  <br />
                  <b>+ 직접 추가</b>로 한 권씩 등록하세요.
                </>
              )}
            </p>
          </div>
        ) : (
          // 표를 overflow 래퍼로 감싸지 않습니다. 래퍼가 새 스크롤 컨테이너를 만들면
          // sticky 머리글의 기준이 화면이 아니라 그 컨테이너가 되어, top 값만큼
          // 머리글이 아래로 밀려 내려와 첫 행을 덮어버립니다.
          // (검색 결과가 1건일 때 "표가 비어 보이는" 증상의 원인이었습니다.)
          // 가로로 넘치면 페이지가 그대로 가로 스크롤됩니다.
          <table className="w-full border-collapse bg-white">
            <thead>
              <tr className="[&>th]:sticky [&>th]:top-[45px] [&>th]:z-10 [&>th]:border-b-2 [&>th]:border-gray-200 [&>th]:bg-white [&>th]:px-2 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-wide [&>th]:text-gray-500 [&>th]:uppercase [&>th]:whitespace-nowrap">
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(books.map((b) => b.id)) : new Set())
                    }
                  />
                </th>
                <th>도서명 / 저자</th>
                <th>ISBN</th>
                <th>출판사</th>
                <th>분류</th>
                <th>출간</th>
                <th className="text-right!">정가(₩)</th>
                <th className="text-right!">CAD</th>
                <th className="text-right!">무게</th>
                <th className="w-32">수량</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <Row
                  key={b.id}
                  book={b}
                  threshold={threshold}
                  checked={selected.has(b.id)}
                  onToggle={(on) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (on) next.add(b.id);
                      else next.delete(b.id);
                      return next;
                    })
                  }
                  onAdjust={(delta) => applyQty(b, { delta })}
                  onSetQty={(qty) => applyQty(b, { qty })}
                  onEdit={() => setEditing(b)}
                  onLog={() => setLogFor(b)}
                  onDelete={() => removeBook(b)}
                />
              ))}
            </tbody>
          </table>
        )}
      </main>

      {/* ───────── 대화상자 ───────── */}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={(msg) => {
          showToast(msg);
          void refresh();
        }}
      />
      <EditDialog
        open={editing !== undefined}
        book={editing ?? null}
        onClose={() => setEditing(undefined)}
        onDone={(msg) => {
          showToast(msg);
          void refresh();
        }}
      />
      <LogDialog book={logFor} onClose={() => setLogFor(null)} />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-100 -translate-x-1/2 rounded-full bg-gray-900/95 px-4 py-2 text-[13px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 표의 한 줄
// ─────────────────────────────────────────────────────────────
function Row({
  book: b,
  threshold,
  checked,
  onToggle,
  onAdjust,
  onSetQty,
  onEdit,
  onLog,
  onDelete,
}: {
  book: BookDTO;
  threshold: number;
  checked: boolean;
  onToggle: (on: boolean) => void;
  onAdjust: (delta: number) => void;
  onSetQty: (qty: number) => void;
  onEdit: () => void;
  onLog: () => void;
  onDelete: () => void;
}) {
  const zero = b.qty <= 0;
  const low = !zero && b.qty <= threshold;
  const qtyCls = zero
    ? "border-red-300 bg-red-50 text-red-600"
    : low
      ? "border-orange-300 bg-orange-50 text-orange-700"
      : "border-gray-200";

  return (
    <tr
      className={`[&>td]:border-b [&>td]:border-gray-200 [&>td]:px-2 [&>td]:py-2 [&>td]:align-middle ${
        checked ? "bg-accent-soft" : "hover:bg-gray-50/60"
      }`}
    >
      <td>
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
      </td>

      <td className="min-w-56">
        <div className="text-[13px] leading-snug font-semibold">{b.title}</div>
        <div className="mt-0.5 text-[11px] text-gray-500">
          {b.author}
          {b.location && ` · 📍${b.location}`}
          {b.memo && ` · ${b.memo}`}
        </div>
      </td>

      <td>
        {b.isbn ? (
          <span
            className={`font-mono text-xs whitespace-nowrap ${
              isValidIsbn(b.isbn) ? "text-gray-600" : "font-sans text-orange-700"
            }`}
            title={isValidIsbn(b.isbn) ? undefined : "표준 ISBN 형식이 아닙니다"}
          >
            {b.isbn}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>

      <td className="text-[13px]">{b.publisher}</td>

      {/* 큰 분류를 굵게, 그 아래 세부 분류. 전체 값은 마우스를 올리면 보입니다. */}
      <td className="max-w-44 text-[12px]" title={b.subject}>
        {b.subject ? (
          <>
            <div className="truncate font-semibold text-gray-700">{subjectGroup(b.subject)}</div>
            {subjectDetail(b.subject) && (
              <div className="truncate text-[11px] text-gray-400">{subjectDetail(b.subject)}</div>
            )}
          </>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>

      <td className="text-[13px] whitespace-nowrap">{b.pubDate}</td>
      <td className="text-right text-[13px] whitespace-nowrap">{fmtInt(b.krw)}</td>
      <td className="text-right text-[13px] whitespace-nowrap">{b.cad?.toFixed(2) ?? ""}</td>
      <td className="text-right text-[13px] whitespace-nowrap">{b.weight ? `${b.weight}g` : ""}</td>

      <td>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onAdjust(-1)}
            title="1 감소"
            className="h-6.5 w-6 rounded-md border border-gray-200 bg-white text-sm leading-none text-gray-600 hover:bg-gray-50"
          >
            −
          </button>
          <input
            type="number"
            className={`no-spin h-6.5 w-14 rounded-md border px-1 text-center text-[13px] font-bold outline-none focus:border-accent ${qtyCls}`}
            defaultValue={b.qty}
            key={b.qty}
            onBlur={(e) => {
              const v = Math.max(0, Math.round(Number(e.target.value) || 0));
              if (v !== b.qty) onSetQty(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <button
            onClick={() => onAdjust(1)}
            title="1 증가"
            className="h-6.5 w-6 rounded-md border border-gray-200 bg-white text-sm leading-none text-gray-600 hover:bg-gray-50"
          >
            ＋
          </button>
        </div>
      </td>

      <td>
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            수정
          </Button>
          <Button size="sm" variant="ghost" onClick={onLog} title="입출고 이력">
            이력
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} title="삭제">
            🗑
          </Button>
        </div>
      </td>
    </tr>
  );
}
