import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Printer,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import {
  type BangkokNowInfo,
  type ClassroomStatePayload,
  type Student,
  computeStudentAttendanceSummary,
} from '../shared/classroomData';

interface SummaryGradebookViewProps {
  state: ClassroomStatePayload;
  nowBangkok: BangkokNowInfo;
  selectedStudentId: string;
  onSelectStudent: (studentId: string) => void;
}

type StatusFilter = 'all' | 'pass' | 'in_progress' | 'fail';

export const SummaryGradebookView: React.FC<SummaryGradebookViewProps> = ({
  state,
  nowBangkok,
  selectedStudentId,
  onSelectStudent,
}) => {
  const [roomFilter, setRoomFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailStudent, setDetailStudent] = useState<Student | null>(null);

  const roomFilters = useMemo(() => {
    const rooms = Array.from(new Set(state.students.map((s) => s.room))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    return [{ id: 'all', label: 'ทุกห้อง' }, ...rooms.map((r) => ({ id: r, label: `ม.5/${r}` }))];
  }, [state.students]);

  const publishedAssignments = useMemo(
    () => state.assignments.filter((a) => a.isPublished).sort((a, b) => a.order - b.order),
    [state.assignments]
  );

  const totalMaxScore = useMemo(
    () => publishedAssignments.reduce((acc, a) => acc + a.maxScore, 0),
    [publishedAssignments]
  );

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.students
      .map((student) => {
        const attendance = computeStudentAttendanceSummary(
          student.id,
          state.attendance,
          nowBangkok
        );
        const scores = publishedAssignments.map((a) => {
          const sub = state.submissions[`${a.id}_${student.id}`];
          return {
            assignment: a,
            submission: sub ?? null,
            score: sub?.score ?? null,
          };
        });
        const totalScore = scores.reduce((sum, item) => sum + (item.score ?? 0), 0);
        const submittedCount = scores.filter((item) => item.submission !== null).length;

        return {
          student,
          attendance,
          scores,
          totalScore,
          submittedCount,
        };
      })
      .filter((r) => {
        if (roomFilter !== 'all' && r.student.room !== roomFilter) return false;
        if (statusFilter === 'pass' && !r.attendance.meets80Now) return false;
        if (statusFilter === 'in_progress' && (r.attendance.meets80Now || !r.attendance.canStillPass80))
          return false;
        if (statusFilter === 'fail' && r.attendance.canStillPass80) return false;
        if (!q) return true;
        return r.student.id.toLowerCase().includes(q) || r.student.name.toLowerCase().includes(q);
      });
  }, [
    state.students,
    state.attendance,
    state.submissions,
    publishedAssignments,
    nowBangkok,
    roomFilter,
    statusFilter,
    searchQuery,
  ]);

  const classStats = useMemo(() => {
    let pass80 = 0;
    let atRisk = 0;
    let totalScoreSum = 0;
    let totalAttendancePct = 0;
    let totalSubmissions = 0;
    for (const r of rows) {
      if (r.attendance.meets80Now) pass80++;
      if (!r.attendance.canStillPass80) atRisk++;
      totalScoreSum += r.totalScore;
      totalAttendancePct += r.attendance.percentOf20;
      totalSubmissions += r.submittedCount;
    }
    const n = rows.length || 1;
    return {
      pass80,
      atRisk,
      avgScore: Math.round((totalScoreSum / n) * 10) / 10,
      avgAttendancePct: Math.round((totalAttendancePct / n) * 10) / 10,
      totalSubmissions,
      maxPossibleSubmissions: rows.length * publishedAssignments.length,
    };
  }, [rows, publishedAssignments.length]);

  function handleExportCsv() {
    const headers = [
      'ลำดับ',
      'รหัสนักเรียน',
      'ชื่อ-สกุล',
      'ชั้น',
      'ห้อง',
      'เลขที่',
      'มาเรียน(สัปดาห์/20)',
      'ขาด(ครั้ง)',
      'ร้อยละเวลาเรียน(%)',
      'เกณฑ์80%',
      ...publishedAssignments.map((a) => `ใบงาน${a.order}(${a.maxScore})`),
      `คะแนนรวม(${totalMaxScore})`,
    ];

    const csvRows = rows.map((r) => [
      r.student.order,
      r.student.id,
      `"${r.student.name}"`,
      r.student.grade,
      r.student.room,
      r.student.number,
      `${r.attendance.presentCount}/20`,
      r.attendance.absentCount,
      r.attendance.percentOf20.toFixed(1),
      r.attendance.meets80Now
        ? 'ผ่านเกณฑ์ 80%'
        : r.attendance.canStillPass80
          ? 'กำลังสะสม'
          : 'ไม่ผ่านเกณฑ์',
      ...r.scores.map((s) => (s.score !== null ? s.score : s.submission ? 'รอตรวจ' : 0)),
      r.totalScore,
    ]);

    const csvString =
      '\uFEFF' + [headers.join(','), ...csvRows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `classroom-report-${nowBangkok.isoDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-6">
      {/* Report Title Header (visible in screen & print) */}
      <div className="overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-xs">
        <div className="h-1 bg-gradient-to-r from-indigo-600 via-blue-500 to-cyan-500" />
        <div className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              รายงานสรุปการมาเรียนและคะแนนใบงาน ({totalMaxScore} คะแนน)
            </h2>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              ชุมนุมสร้างสรรค์ภาพด้วย AI · ข้อมูล ณ วันที่ {nowBangkok.isoDate} เวลา{' '}
              {nowBangkok.timeHHMM} น. · นักเรียนในมุมมองนี้ {rows.length} คน
            </p>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50"
            >
              <Printer className="h-4 w-4" />
              <span>พิมพ์รายงาน / PDF</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800"
            >
              <Download className="h-4 w-4" />
              <span>ดาวน์โหลด CSV</span>
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-xs">
          <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="p-5">
          <div className="text-xs font-medium text-emerald-800">
            สรุปเกณฑ์เวลาเรียนร้อยละ 80 (16/20 สัปดาห์)
          </div>
          <div className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">
            {classStats.pass80}{' '}
            <span className="text-sm font-normal text-slate-500">/ {rows.length} คน ผ่านเกณฑ์แล้ว</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            เฉลี่ยเวลาเรียน {classStats.avgAttendancePct.toFixed(1)}% · ไม่ถึงเกณฑ์ {classStats.atRisk} คน
          </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-xs">
          <div className="h-1 bg-gradient-to-r from-blue-600 to-indigo-600" />
          <div className="p-5">
          <div className="text-xs font-medium text-blue-800">
            คะแนนใบงานเฉลี่ย ({publishedAssignments.length} ใบงาน)
          </div>
          <div className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">
            {classStats.avgScore}{' '}
            <span className="text-sm font-normal text-slate-500">/ {totalMaxScore} คะแนน</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            ส่งงานแล้วทั้งหมด {classStats.totalSubmissions} / {classStats.maxPossibleSubmissions} ชิ้น
          </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xs">
          <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <div className="p-5">
          <div className="text-xs font-medium text-amber-800">การตรวจสอบรายละเอียดรายบุคคล</div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            คลิกที่ชื่อนักเรียนในตารางเพื่อดูภาพผลงานที่อัปโหลด คำสั่ง Prompt และคะแนนรายใบงานทั้งหมด
          </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="no-print flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
            {roomFilters.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => setRoomFilter(room.id)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  roomFilter === room.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {room.label}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="กรองตามสถานะเวลาเรียน"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-600"
          >
            <option value="all">ทุกสถานะเวลาเรียน</option>
            <option value="pass">ผ่านเกณฑ์ ≥ 80%</option>
            <option value="in_progress">กำลังสะสมเวลาเรียน</option>
            <option value="fail">ไม่ผ่านเกณฑ์ &lt; 80%</option>
          </select>
        </div>

        <div className="relative w-full lg:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาชื่อ หรือ รหัส..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-600"
          />
        </div>
      </div>

      {/* Summary Gradebook Table */}
      <div className="overflow-hidden rounded-xl border border-indigo-200/80 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-blue-50/70 to-sky-50/80 text-xs font-semibold text-indigo-950">
                <th className="px-3 py-3 text-center">ลำดับ</th>
                <th className="px-3 py-3">รหัส</th>
                <th className="px-3 py-3">ชื่อ-สกุล</th>
                <th className="px-3 py-3">ห้อง/เลขที่</th>
                <th className="px-3 py-3 text-right">มาเรียน</th>
                <th className="px-3 py-3 text-right">ขาด</th>
                <th className="px-3 py-3">เกณฑ์ 80%</th>
                {publishedAssignments.map((a) => (
                  <th key={a.id} className="px-3 py-3 text-right whitespace-nowrap">
                    ใบงาน {a.order} ({a.maxScore})
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-bold text-slate-900 whitespace-nowrap">
                  รวม ({totalMaxScore})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ student, attendance, scores, totalScore }) => {
                const isSelected = selectedStudentId === student.id;
                return (
                  <tr
                    key={student.id}
                    className={`transition-colors hover:bg-slate-50/80 ${
                      isSelected ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    <td className="px-3 py-3 text-center font-mono text-xs text-slate-500 tabular-nums">
                      {student.order}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-700 tabular-nums">
                      {student.id}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectStudent(student.id);
                          setDetailStudent(student);
                        }}
                        className="text-left font-medium text-blue-800 hover:underline"
                      >
                        {student.name}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {student.grade}/{student.room} · {student.number}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-slate-900">
                        {attendance.presentCount}/20
                      </span>{' '}
                      <span className="text-slate-500">({attendance.percentOf20.toFixed(0)}%)</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-red-700 tabular-nums">
                      {attendance.absentCount}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {attendance.meets80Now ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          ผ่านเกณฑ์ 80%
                        </span>
                      ) : attendance.canStillPass80 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          กำลังสะสม ({attendance.presentCount}/16)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                          <XCircle className="h-3.5 w-3.5" />
                          ไม่ผ่านเกณฑ์
                        </span>
                      )}
                    </td>
                    {scores.map((item) => (
                      <td
                        key={item.assignment.id}
                        className="px-3 py-3 text-right font-mono text-xs tabular-nums"
                      >
                        {item.score !== null ? (
                          <span className="font-semibold text-slate-900">{item.score}</span>
                        ) : item.submission ? (
                          <span className="text-amber-700">รอตรวจ</span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold text-blue-800 tabular-nums">
                      {totalScore}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={8 + publishedAssignments.length}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    ไม่พบข้อมูลนักเรียนตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailStudent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setDetailStudent(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="font-mono text-xs text-slate-500 tabular-nums">
                  รหัสนักเรียน {detailStudent.id} · {detailStudent.grade}/{detailStudent.room} เลขที่{' '}
                  {detailStudent.number}
                </div>
                <h3 className="mt-1 text-xl font-bold text-slate-900">{detailStudent.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailStudent(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {(() => {
              const att = computeStudentAttendanceSummary(
                detailStudent.id,
                state.attendance,
                nowBangkok
              );
              const totalEarned = publishedAssignments.reduce((acc, a) => {
                const sub = state.submissions[`${a.id}_${detailStudent.id}`];
                return acc + (sub?.score ?? 0);
              }, 0);

              return (
                <div className="mt-5 space-y-6">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">มาเรียน</div>
                      <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                        {att.presentCount}/20 สัปดาห์
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">ร้อยละเวลาเรียน</div>
                      <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                        {att.percentOf20.toFixed(1)}%
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">ขาด / ไม่เข้าชุมนุม</div>
                      <div className="mt-1 font-mono text-lg font-bold text-red-700 tabular-nums">
                        {att.absentCount} ครั้ง
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">คะแนนงานรวม</div>
                      <div className="mt-1 font-mono text-lg font-bold text-blue-800 tabular-nums">
                        {totalEarned}/{totalMaxScore}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-900">รายการส่งใบงานและภาพผลงาน</h4>
                    <div className="mt-3 space-y-3">
                      {publishedAssignments.map((a) => {
                        const sub = state.submissions[`${a.id}_${detailStudent.id}`];
                        return (
                          <div
                            key={a.id}
                            className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3.5 sm:flex-row sm:items-center"
                          >
                            {sub?.imageUrl ? (
                              <img
                                src={sub.imageUrl}
                                alt={a.title}
                                referrerPolicy="no-referrer"
                                className="h-20 w-28 shrink-0 rounded border border-slate-200 object-cover"
                              />
                            ) : (
                              <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
                                ยังไม่ส่ง
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="truncate text-sm font-semibold text-slate-900">
                                  {a.title}
                                </div>
                                <div className="shrink-0 font-mono text-xs font-bold text-slate-900 tabular-nums">
                                  {sub?.score !== null && sub?.score !== undefined
                                    ? `${sub.score}/${a.maxScore}`
                                    : sub
                                      ? 'รอตรวจ'
                                      : `0/${a.maxScore}`}
                                </div>
                              </div>
                              {sub?.promptText && (
                                <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                                  Prompt: {sub.promptText}
                                </p>
                              )}
                              {sub?.feedback && (
                                <p className="mt-1 text-xs font-medium text-blue-700">
                                  ความเห็นครู: {sub.feedback}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </section>
  );
};
