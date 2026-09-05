"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BUILTIN_PRESETS,
  FIELDS,
  buildPlan,
  guessMapping,
  splitRows,
  type Delimiter,
} from "@/lib/parse";
import type { ImportPresetDTO } from "@/lib/types";
import { Button, Modal, Select } from "./ui";

type InMode = "add" | "replace" | "skip";
type Direction = "in" | "out";
/** matchKey → 현재 재고 */
type StockMap = Map<string, { qty: number; title: string }>;

/**
 * 미리보기에서 줄마다 "무슨 일이 일어나는지" 보여 주는 딱지.
 * 엑셀 중간에 사람이 비워 둔 줄이 조용히 지나가지 않도록,
 * 왜 빠지는지(또는 왜 들어가는지)를 줄 단위로 밝힙니다.
 */
const ROW_VERDICT: Record<string, { label: string; cls: string; kind: "book" | "skip" | "merged"; hint: string }> = {
  new: { label: "등록", cls: "text-green-700", kind: "book", hint: "재고에 없는 책이라 새로 등록됩니다" },
  update: { label: "반영", cls: "text-accent", kind: "book", hint: "이미 있는 책이라 수량이 반영됩니다" },
  merged: { label: "합침", cls: "text-accent", kind: "merged", hint: "윗줄 도서에 합쳐집니다" },
  header: { label: "머리글", cls: "text-gray-400", kind: "skip", hint: "머리글 행이라 제외합니다" },
  empty: { label: "빈 줄", cls: "text-gray-400", kind: "skip", hint: "도서명도 ISBN도 없어 제외합니다" },
  noTitle: { label: "제목 없음", cls: "text-red-500", kind: "skip", hint: "ISBN 은 있는데 도서명이 비어 있어 제외합니다" },
};

export default function ImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [delim, setDelim] = useState<Delimiter>("auto");
  const [presetKey, setPresetKey] = useState("auto");
  const [direction, setDirection] = useState<Direction>("in");
  const [mode, setMode] = useState<InMode>("add");
  const [updateMeta, setUpdateMeta] = useState(true);
  const [multiRow, setMultiRow] = useState(false);
  const [reason, setReason] = useState("");

  const [mapping, setMapping] = useState<string[]>([]);
  const [stock, setStock] = useState<StockMap>(new Map());
  const [savedPresets, setSavedPresets] = useState<ImportPresetDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // ── 저장된 양식 불러오기 ──
  const loadPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/presets");
      if (!res.ok) return;
      const data = await res.json();
      setSavedPresets(data.presets ?? []);
    } catch {
      /* 양식이 없어도 기본 양식으로 동작합니다 */
    }
  }, []);

  useEffect(() => {
    if (open) void loadPresets();
  }, [open, loadPresets]);

  const presetOptions = useMemo(
    () => [
      ...Object.entries(BUILTIN_PRESETS).map(([key, p]) => ({
        key,
        name: p.name,
        mapping: p.mapping,
        direction: p.direction,
        multiRow: p.multiRow === true,
      })),
      ...savedPresets.map((p) => ({
        key: `db:${p.id}`,
        name: p.name,
        mapping: p.mapping,
        direction: p.direction as "in" | "out" | undefined,
        multiRow: p.multiRow === true,
      })),
    ],
    [savedPresets],
  );

  // 납품 인보이스 양식을 고르면 방향(출고)과 2줄 여부가 따라옵니다.
  // 출고 문서는 로마자 제목·메모가 섞여 있어 서지정보 갱신도 꺼 둡니다.
  useEffect(() => {
    const preset = presetOptions.find((p) => p.key === presetKey);
    if (!preset?.mapping) return;
    setMultiRow(preset.multiRow);
    if (preset.direction) {
      setDirection(preset.direction);
      if (preset.direction === "out") setUpdateMeta(false);
    }
    // 양식을 바꿀 때만 반응합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey, savedPresets]);

  const { rows } = useMemo(() => splitRows(text, delim), [text, delim]);
  const width = rows.length ? Math.max(...rows.map((r) => r.length)) : 0;

  // 고른 양식의 열 수와 붙여넣은 열 수가 다르면 값이 통째로 밀립니다.
  // (예: 16열 선박 양식으로 15열 데이터를 붙여넣는 경우)
  const presetWidth = presetOptions.find((p) => p.key === presetKey)?.mapping?.length ?? 0;
  const widthMismatch = presetWidth > 0 && width > 0 && presetWidth !== width;

  // ── 붙여넣기 내용·양식·구분자가 바뀌면 열 지정을 다시 계산 ──
  useEffect(() => {
    if (!rows.length) {
      setMapping([]);
      return;
    }
    const preset = presetOptions.find((p) => p.key === presetKey);
    const base = preset?.mapping ? [...preset.mapping] : guessMapping(rows);
    const next = base.slice(0, width);
    while (next.length < width) next.push("");
    setMapping(next);
    // rows 는 매 렌더마다 새 배열이므로 내용 기준(text)으로만 반응시킵니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, delim, presetKey, width, presetOptions]);

  // ── 도서가 아닌 행(머리글·구역 제목·합계)을 걸러낸 계획 ──
  const plan = useMemo(
    () => (mapping.length ? buildPlan(rows, mapping, new Set(), { multiRow }) : []),
    [rows, mapping, multiRow],
  );

  const planKeys = useMemo(
    () => plan.map((p) => p.matchKey).filter((k): k is string => Boolean(k)),
    [plan],
  );

  // ── 어떤 책이 이미 재고에 있는지 / 몇 권 있는지 서버에 확인 ──
  useEffect(() => {
    if (!planKeys.length) {
      setStock(new Map());
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/books/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: planKeys }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStock(
          new Map(
            (data.existing ?? []).map((b: { matchKey: string; qty: number; title: string }) => [
              b.matchKey,
              { qty: b.qty, title: b.title },
            ]),
          ),
        );
      } catch {
        /* 확인에 실패해도 반영은 서버가 최종 판단합니다 */
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [planKeys.join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 미리보기 집계 ──
  const summary = useMemo(() => {
    const books = plan.filter((p) => p.status === "new" || p.status === "update");
    // "merged" 는 윗줄에 합쳐진 줄이라 버려진 게 아닙니다.
    const skipped = plan.filter(
      (p) => p.status === "header" || p.status === "empty" || p.status === "noTitle",
    ).length;
    const mergedRows = plan.filter((p) => p.status === "merged").length;

    // ISBN 은 있는데 도서명이 없어 버려지는 줄 (몇 번째 줄인지 알려 줍니다)
    const noTitleLines = plan
      .filter((p) => p.status === "noTitle")
      .map((p) => p.idx + 1);

    // 같은 책이 여러 줄에 나오면 합쳐서 셉니다.
    const perBook = new Map<string, { title: string; qty: number }>();
    for (const p of books) {
      const key = p.matchKey!;
      const qty = p.item!.qty ?? 1;
      const prev = perBook.get(key);
      if (prev) prev.qty += qty;
      else perBook.set(key, { title: p.item!.title!, qty });
    }

    if (direction === "in") {
      let isNew = 0;
      for (const key of perBook.keys()) if (!stock.has(key)) isNew++;
      return {
        titles: perBook.size,
        isNew,
        existing: perBook.size - isNew,
        zeroQty: 0,
        skipped,
        mergedRows,
        noTitleLines,
        missing: [] as string[],
        shortfall: [] as { title: string; had: number; needed: number }[],
        duplicates: books.length - perBook.size,
      };
    }

    const missing: string[] = [];
    const shortfall: { title: string; had: number; needed: number }[] = [];
    let zeroQty = 0;
    let willChange = 0;
    for (const [key, v] of perBook) {
      // Copies 0 = 주문했지만 나가지 않은 줄. 아무 일도 하지 않으므로 경고하지 않습니다.
      if (v.qty <= 0) {
        zeroQty++;
        continue;
      }
      const have = stock.get(key);
      if (!have) {
        missing.push(v.title);
        continue;
      }
      if (have.qty < v.qty) shortfall.push({ title: have.title, had: have.qty, needed: v.qty });
      if (have.qty > 0) willChange++;
    }
    return {
      titles: perBook.size,
      isNew: 0,
      existing: willChange,
      zeroQty,
      skipped,
      mergedRows,
      noTitleLines,
      missing,
      shortfall,
      duplicates: books.length - perBook.size,
    };
  }, [plan, stock, direction]);

  const applicable = direction === "out" ? summary.existing : summary.titles;

  // ── 열 지정 변경 ──
  function setColumn(col: number, field: string) {
    setMapping((prev) => {
      // 같은 필드를 두 열에 지정할 수 없으므로 기존 지정을 해제합니다.
      const next = field ? prev.map((m) => (m === field ? "" : m)) : [...prev];
      next[col] = field;
      return next;
    });
  }

  async function savePreset() {
    const name = prompt("이 열 순서를 어떤 이름으로 저장할까요?", "새 양식");
    if (!name?.trim()) return;
    const res = await fetch("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), mapping, direction, multiRow }),
    });
    if (!res.ok) return setError("양식 저장에 실패했습니다.");
    const data = await res.json();
    await loadPresets();
    setPresetKey(`db:${data.preset.id}`);
  }

  async function deletePreset() {
    const id = presetKey.startsWith("db:") ? presetKey.slice(3) : null;
    if (!id) return;
    const name = presetOptions.find((p) => p.key === presetKey)?.name;
    if (!confirm(`"${name}" 양식을 삭제할까요?`)) return;
    await fetch(`/api/presets/${id}`, { method: "DELETE" });
    setPresetKey("auto");
    await loadPresets();
  }

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, mapping, direction, mode, updateMeta, multiRow, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "반영에 실패했습니다.");

      const parts =
        direction === "out"
          ? [`${data.updated}종 출고`]
          : [`신규 ${data.created}종`, `갱신 ${data.updated}종`];
      if (data.missing?.length) parts.push(`재고에 없어 건너뜀 ${data.missing.length}종`);
      if (data.shortfall?.length) parts.push(`재고 부족 ${data.shortfall.length}종`);
      if (data.skippedRows) parts.push(`도서 아닌 행 ${data.skippedRows}개 제외`);
      onDone(parts.join(" · "));
      setText("");
      setReason("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "반영에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const outbound = direction === "out";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="📋 엑셀에서 붙여넣기"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={apply} disabled={busy || applicable === 0}>
            {busy
              ? "반영 중…"
              : outbound
                ? `재고에서 빼기 (${applicable}종)`
                : `재고에 반영 (${applicable}종)`}
          </Button>
        </>
      }
    >
      {/* ── 입고 / 출고 ── */}
      <div className="mb-3 flex gap-2">
        {(
          [
            { key: "in", label: "📥 입고", desc: "매입·선박 — 재고를 늘립니다" },
            { key: "out", label: "📤 출고", desc: "납품·판매 — 재고를 줄입니다" },
          ] as const
        ).map((d) => (
          <button
            key={d.key}
            onClick={() => setDirection(d.key)}
            className={`flex-1 rounded-lg border px-3 py-2 text-left transition ${
              direction === d.key
                ? d.key === "out"
                  ? "border-orange-400 bg-orange-50"
                  : "border-accent bg-accent-soft"
                : "border-gray-200 bg-white hover:bg-gray-50"
            }`}
          >
            <div className="text-[13px] font-bold">{d.label}</div>
            <div className="mt-0.5 text-[11px] text-gray-500">{d.desc}</div>
          </button>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-gray-500">
        엑셀에서 <b>행 전체를 복사</b>해 아래 칸에 붙여넣으세요 (Ctrl+V). 머리글, <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">Teen FIC</code>{" "}
        같은 구역 제목, 합계·예산 행은 <b>도서명이 비어 있어 자동으로 빠집니다.</b>
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="여기에 붙여넣기 (Ctrl+V)"
        spellCheck={false}
        className="mt-2 h-32 w-full resize-y overflow-x-auto rounded-lg border border-gray-200 p-2.5 font-mono text-xs whitespace-pre outline-none focus:border-accent"
      />

      <div className="my-3 flex flex-wrap items-center gap-3.5">
        <Select label="양식" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
          {presetOptions.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </Select>

        <Select label="구분자" value={delim} onChange={(e) => setDelim(e.target.value as Delimiter)}>
          <option value="auto">자동 감지</option>
          <option value="tab">탭</option>
          <option value="spaces">공백 2칸 이상</option>
          <option value="comma">쉼표(,)</option>
        </Select>

        {!outbound && (
          <Select label="같은 책이 있으면" value={mode} onChange={(e) => setMode(e.target.value as InMode)}>
            <option value="add">수량 더하기</option>
            <option value="replace">수량 덮어쓰기</option>
            <option value="skip">건너뛰기</option>
          </Select>
        )}

        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <input type="checkbox" checked={updateMeta} onChange={(e) => setUpdateMeta(e.target.checked)} />
          서지정보(저자·출판사 등)도 갱신
        </label>

        <label
          className="flex items-center gap-1.5 text-xs text-gray-500"
          title="LBI 인보이스처럼 윗줄에 로마자 제목, 아랫줄에 한글 제목이 오는 양식"
        >
          <input type="checkbox" checked={multiRow} onChange={(e) => setMultiRow(e.target.checked)} />
          두 줄이 한 권
        </label>

        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          사유
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={outbound ? "BPL 납품 2026-08" : "선박 2026-08"}
            className="w-44 rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] outline-none focus:border-accent"
          />
        </label>
      </div>

      {outbound && updateMeta && (
        <p className="mb-2 text-xs text-orange-700">
          ⚠️ 출고 문서에는 로마자 제목이나 메모(<code className="rounded bg-orange-100 px-1">Qty. increased upon request</code>)가 섞여
          있을 수 있습니다. 재고의 서지정보가 덮어써질 수 있으니 끄는 것을 권합니다.
        </p>
      )}

      {widthMismatch && (
        <div className="mb-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs">
          <b className="text-orange-800">
            열 수가 안 맞습니다 — 고른 양식은 {presetWidth}열인데 붙여넣은 데이터는 {width}열입니다.
          </b>
          <div className="mt-1 text-gray-600">
            값이 한 칸씩 밀려 있을 수 있습니다. 아래 표에서 각 열이 맞는지 확인하거나,
            양식을 <b>자동 감지</b>로 바꾸거나, 열 수가 맞는 다른 양식을 골라 주세요.
          </div>
        </div>
      )}

      {mapping.length > 0 && (
        <>
          <p className="mb-1.5 text-xs leading-relaxed text-gray-500">
            아래 표에서 <b>각 열이 무엇인지</b> 지정하세요. 쓰지 않을 열은{" "}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">— 사용 안 함</code>으로 두면 됩니다.
            {outbound && <> 수량 열에는 <b>나간 권수</b>를 지정하세요.</>}
          </p>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border border-gray-200 bg-gray-50 p-1.5 align-top">
                    <div className="mb-1 text-[10px] text-gray-400">줄</div>
                    <div className="text-[11px] font-semibold text-gray-500">결과</div>
                  </th>
                  {mapping.map((field, i) => (
                    <th key={i} className="border border-gray-200 bg-gray-50 p-1.5 align-top">
                      <div className="mb-1 text-[10px] text-gray-400">{i + 1}열</div>
                      <select
                        value={field}
                        onChange={(e) => setColumn(i, e.target.value)}
                        className={`w-full min-w-28 rounded border px-1 py-1 text-[11px] outline-none ${
                          field ? "border-accent bg-accent-soft font-semibold" : "border-gray-200 bg-white"
                        }`}
                      >
                        {FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 12).map((row, r) => {
                  const p = plan[r];
                  const v = ROW_VERDICT[p?.status ?? "empty"];
                  const skip = v.kind === "skip";
                  // 수량 칸이 비면 1권으로 처리합니다. 선박 양식은 A열 TOTAL 이 늘 채워져
                  // 있어 거의 없는 경우라, 경고 대신 조용한 표시만 답니다.
                  const qtyGuessed = v.kind === "book" && p?.item?.qty == null;
                  return (
                    <tr
                      key={r}
                      className={
                        skip
                          ? "bg-gray-50 text-gray-300"
                          : v.kind === "merged"
                            ? "bg-accent-soft/60 text-gray-600"
                            : ""
                      }
                    >
                      <td
                        className="sticky left-0 z-10 border border-gray-200 bg-inherit px-1.5 py-1 whitespace-nowrap"
                        title={v.hint}
                      >
                        <span className="mr-1 text-[10px] text-gray-400">{r + 1}</span>
                        <span className={`text-[11px] font-semibold ${v.cls}`}>{v.label}</span>
                        {qtyGuessed && (
                          <span className="ml-1 text-[10px] text-gray-400" title="수량 칸이 비어 1권으로 처리됩니다">
                            1권
                          </span>
                        )}
                      </td>
                      {mapping.map((_, i) => (
                        <td
                          key={i}
                          className={`max-w-48 truncate border border-gray-200 px-1.5 py-1 text-[11px] whitespace-nowrap ${
                            skip ? "line-through" : ""
                          }`}
                          title={row[i]}
                        >
                          {row[i]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={savePreset}>
              이 매핑을 양식으로 저장
            </Button>
            {presetKey.startsWith("db:") && (
              <Button size="sm" variant="danger" onClick={deletePreset}>
                현재 양식 삭제
              </Button>
            )}
          </div>

          {/* ── 요약 ── */}
          <div className="mt-3 flex flex-wrap gap-4 rounded-lg bg-gray-50 px-3 py-2.5 text-xs">
            {outbound ? (
              <>
                <span>
                  재고에서 뺄 도서 <b className="text-sm text-orange-700">{summary.existing}</b>종
                </span>
                {summary.missing.length > 0 && (
                  <span>
                    재고에 없음 <b className="text-sm text-red-600">{summary.missing.length}</b>종
                  </span>
                )}
                {summary.shortfall.length > 0 && (
                  <span>
                    재고 부족 <b className="text-sm text-red-600">{summary.shortfall.length}</b>종
                  </span>
                )}
                {summary.zeroQty > 0 && (
                  <span className="text-gray-500">
                    0권이라 변화 없음 <b className="text-sm">{summary.zeroQty}</b>종
                  </span>
                )}
              </>
            ) : (
              <>
                <span>
                  새로 등록 <b className="text-sm text-green-700">{summary.isNew}</b>종
                </span>
                <span>
                  기존 재고 반영 <b className="text-sm text-accent">{summary.existing}</b>종
                </span>
              </>
            )}
            <span className="text-gray-500">
              도서 아닌 행 <b className="text-sm">{summary.skipped}</b>개 제외
            </span>
            {summary.mergedRows > 0 && (
              <span className="text-accent">
                윗줄에 합친 줄 <b className="text-sm">{summary.mergedRows}</b>개
              </span>
            )}
            {summary.duplicates > 0 && (
              <span className="text-gray-500">
                같은 책 합침 <b className="text-sm">{summary.duplicates}</b>행
              </span>
            )}
            {rows.length > 12 && (
              <span className="ml-auto text-gray-400">전체 {rows.length}줄 중 12줄만 미리보기</span>
            )}
          </div>

          {/* ── 사람이 비워 둔 칸 안내 ── */}
          {summary.noTitleLines.length > 0 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
              <b className="text-red-700">
                ISBN 은 있는데 도서명이 빈 줄이 {summary.noTitleLines.length}개 있어 제외합니다.
              </b>{" "}
              <span className="text-gray-600">
                {summary.noTitleLines.slice(0, 10).join(", ")}
                {summary.noTitleLines.length > 10 && " …"}번째 줄. 도서명 열 지정이 맞는지, 엑셀에 제목이
                빠지지 않았는지 확인하세요.
              </span>
            </div>
          )}

          {/* ── 출고 경고 ── */}
          {outbound && summary.missing.length > 0 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
              <b className="text-red-700">재고에 없는 책 {summary.missing.length}종은 건너뜁니다.</b>{" "}
              <span className="text-gray-600">매입(입고)이 기록되지 않은 책일 수 있습니다.</span>
              <div className="mt-1 text-[11px] text-gray-500">
                {summary.missing.slice(0, 6).join(" · ")}
                {summary.missing.length > 6 && ` 외 ${summary.missing.length - 6}종`}
              </div>
            </div>
          )}
          {outbound && summary.shortfall.length > 0 && (
            <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs">
              <b className="text-orange-800">재고보다 많이 나가는 책 {summary.shortfall.length}종은 0권에서 멈춥니다.</b>
              <div className="mt-1 text-[11px] text-gray-600">
                {summary.shortfall
                  .slice(0, 5)
                  .map((s) => `${s.title} (재고 ${s.had} < 출고 ${s.needed})`)
                  .join(" · ")}
                {summary.shortfall.length > 5 && ` 외 ${summary.shortfall.length - 5}종`}
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-3 text-xs font-medium text-red-600">{error}</p>}
    </Modal>
  );
}
