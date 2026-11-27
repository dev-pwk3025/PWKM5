import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCog,
  CheckCircle2,
  Clock,
  Pencil,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import {
  type BangkokNowInfo,
  type ClassroomStatePayload,
  type Student,
  computeStudentAttendanceSummary,
} from '../shared/classroomData';
import {
  submitStudentSelfCheckIn,
  teacherBulkSetWeekAttendance,
  teacherClearAttendance,
  teacherDeleteStudent,
  teacherSaveStudent,
  teacherSetAttendance,
} from '../services/classroomFirebase';

interface AttendanceCheckinViewProps {
  state: ClassroomStatePayload;
  nowBangkok: BangkokNowInfo;
  selectedStudentId: string;
  onSelectStudent: (studentId: string) => void;
  isTeacher: boolean;
  onNotify: (msg: string, tone: 'success' | 'error') => void;
}

function extractFirebaseErrMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('Missing or insufficient permissions') || raw.includes('permission-denied')) {
    return 'ยังไม่ได้ตั้งค่า Firestore Rules ใน Firebase Console (กรุณานำไฟล์ firestore.rules ไปวางในโปรเจกต์ devpwk-a0115-459302)';
  }
  return raw || fallback;
}

export const AttendanceCheckinView: React.FC<AttendanceCheckinViewProps> = ({
  state,
  nowBangkok,
  selectedStudentId,
  onSelectStudent,
  isTeacher,
  onNotify,
}) => {
  const [roomFilter, setRoomFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [checkingStudentId, setCheckingStudentId] = useState<string | null>(null);
  const [teacherSelectedWeek, setTeacherSelectedWeek] = useState<number>(
    nowBangkok.currentWeek?.week ?? 4
  );

  // Add/Edit Student modal state
  const [studentFormOpen, setStudentFormOpen] = useState(false);
  const [editingPreviousId, setEditingPreviousId] = useState<string | undefined>(undefined);
  const [formOrder, setFormOrder] = useState('1');
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formGrade, setFormGrade] = useState('ม.5');
  const [formRoom, setFormRoom] = useState('8');
  const [formNumber, setFormNumber] = useState('1');
  const [savingStudent, setSavingStudent] = useState(false);

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deletingStudent, setDeletingStudent] = useState(false);

  // Per-student 20-week attendance editor modal
  const [attendanceModalStudent, setAttendanceModalStudent] = useState<Student | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const roomFilters = useMemo(() => {
    const rooms = Array.from(new Set(state.students.map((s) => s.room))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    return [
      { id: 'all', label: `ทุกห้อง (${state.students.length} คน)` },
      ...rooms.map((r) => ({ id: r, label: `ม.5/${r}` })),
    ];
  }, [state.students]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.students.filter((s) => {
      if (roomFilter !== 'all' && s.room !== roomFilter) return false;
      if (!q) return true;
      return s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
    });
  }, [state.students, roomFilter, searchQuery]);

  const activeWeek = nowBangkok.currentWeek;
  const displayWeekNumber = isTeacher ? teacherSelectedWeek : activeWeek?.week ?? 4;
  const displayWeekObj =
    state.weeks.find((w) => w.week === displayWeekNumber) ?? state.weeks[3];

  async function handleSelfCheckIn(student: Student) {
    onSelectStudent(student.id);
    setCheckingStudentId(student.id);
    try {
      const msg = await submitStudentSelfCheckIn(student.id, state.students);
      onNotify(msg, 'success');
    } catch (err) {
      onNotify(extractFirebaseErrMessage(err, 'ไม่สามารถเช็คชื่อได้'), 'error');
    } finally {
      setCheckingStudentId(null);
    }
  }

  async function handleTeacherToggleAttendance(
    student: Student,
    week: number,
    nextStatus: 'present' | 'absent'
  ) {
    if (!isTeacher) return;
    setCheckingStudentId(student.id);
    try {
      await teacherSetAttendance(student.id, week, nextStatus);
      onNotify(
        `บันทึก "${nextStatus === 'present' ? 'มาเรียน' : 'ขาด'}" ให้ ${student.name} (สัปดาห์ที่ ${week}) แล้ว`,
        'success'
      );
    } catch (err) {
      onNotify(extractFirebaseErrMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'), 'error');
    } finally {
      setCheckingStudentId(null);
    }
  }

  async function handleTeacherClearWeek(student: Student, week: number) {
    if (!isTeacher) return;
    setCheckingStudentId(student.id);
    try {
      await teacherClearAttendance(student.id, week);
      onNotify(`ล้างสถานะสัปดาห์ที่ ${week} ของ ${student.name} แล้ว`, 'success');
    } catch (err) {
      onNotify(extractFirebaseErrMessage(err, 'ไม่สามารถล้างสถานะได้'), 'error');
    } finally {
      setCheckingStudentId(null);
    }
  }

  async function handleBulkMarkWeek(status: 'present' | 'absent') {
    if (!isTeacher || filteredStudents.length === 0) return;
    setBulkBusy(true);
    try {
      await teacherBulkSetWeekAttendance(filteredStudents, displayWeekObj.week, status);
      onNotify(
        `บันทึก "${status === 'present' ? 'มาเรียน' : 'ขาด'}" ให้ ${filteredStudents.length} คน ในสัปดาห์ที่ ${displayWeekObj.week} แล้ว`,
        'success'
      );
    } catch (err) {
      onNotify(extractFirebaseErrMessage(err, 'บันทึกแบบกลุ่มไม่สำเร็จ'), 'error');
    } finally {
      setBulkBusy(false);
    }
  }

  function openAddStudentModal() {
    const nextOrder =
      state.students.reduce((max, s) => Math.max(max, s.order), 0) + 1;
    setEditingPreviousId(undefined);
    setFormOrder(String(nextOrder));
    setFormId('');
    setFormName('');
    setFormGrade('ม.5');
    setFormRoom(roomFilter !== 'all' ? roomFilter : '8');
    setFormNumber('1');
    setStudentFormOpen(true);
  }

  function openEditStudentModal(student: Student) {
    setEditingPreviousId(student.id);
    setFormOrder(String(student.order));
    setFormId(student.id);
    setFormName(student.name);
    setFormGrade(student.grade);
    setFormRoom(student.room);
    setFormNumber(String(student.number));
    setStudentFormOpen(true);
  }

  async function handleSaveStudentForm(e: React.FormEvent) {
    e.preventDefault();
    setSavingStudent(true);
    try {
      await teacherSaveStudent(
        {
          order: Number(formOrder) || 1,
          id: formId.trim(),
          name: formName.trim(),
          grade: formGrade.trim() || 'ม.5',
          room: formRoom.trim() || '1',
          number: Number(formNumber) || 1,
        },
        editingPreviousId
      );
      setStudentFormOpen(false);
      onNotify(
        editingPreviousId
          ? `แก้ไขข้อมูล ${formName.trim()} เรียบร้อยแล้ว`
          : `เพิ่มนักเรียน ${formName.trim()} เรียบร้อยแล้ว`,
        'success'
      );
    } catch (err) {
      onNotify(extractFirebaseErrMessage(err, 'บันทึกข้อมูลนักเรียนไม่สำเร็จ'), 'error');
    } finally {
      setSavingStudent(false);
    }
  }

  async function handleConfirmDeleteStudent() {
    if (!deleteTarget) return;
    setDeletingStudent(true);
    try {
      await teacherDeleteStudent(deleteTarget.id);
      if (selectedStudentId === deleteTarget.id) {
        onSelectStudent('');
      }
      onNotify(`ลบรายชื่อ ${deleteTarget.name} เรียบร้อยแล้ว`, 'success');
      setDeleteTarget(null);
    } catch (err) {
      onNotify(extractFirebaseErrMessage(err, 'ลบรายชื่อไม่สำเร็จ'), 'error');
    } finally {
      setDeletingStudent(false);
    }
  }

  const todayStats = useMemo(() => {
    let present = 0;
    let absentOrNotChecked = 0;
    for (const s of state.students) {
      const rec = state.attendance[`${s.id}_${displayWeekNumber}`];
      if (rec?.status === 'present') present++;
      else absentOrNotChecked++;
    }
    return { present, absentOrNotChecked };
  }, [state.students, state.attendance, displayWeekNumber]);

  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-xs">
        <div className="h-1 bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500" />
        <div className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <span>{nowBangkok.weekdayThai}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{nowBangkok.isoDate}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">เวลาไทย {nowBangkok.timeHHMMSS} น.</span>
              <span aria-hidden="true">·</span>
              <span>เกณฑ์ผ่าน 80% (16/20 สัปดาห์)</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              เช็คชื่อนักเรียนด้วยตนเอง (ทุกวันพฤหัสบดี 14:55 – 15:50 น.)
            </h2>
            <p className="text-sm text-slate-600">{nowBangkok.windowMessage}</p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {nowBangkok.isWithinCheckinWindow ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span>เปิดรับเช็คชื่อ (14:55–15:50 น.)</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
                <Clock className="h-5 w-5 text-amber-600" />
                <span>
                  {nowBangkok.isThursday
                    ? nowBangkok.windowStatus === 'before_window'
                      ? 'ยังไม่ถึงเวลา 14:55 น.'
                      : 'ปิดรับเช็คชื่อ (นอกเวลา)'
                    : 'เฉพาะวันพฤหัสบดีเท่านั้น'}
                </span>
              </div>
            )}
          </div>
        </div>

        {isTeacher && (
          <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openAddStudentModal}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800"
              >
                <UserPlus className="h-4 w-4" />
                <span>เพิ่มนักเรียน</span>
              </button>
              <button
                type="button"
                disabled={bulkBusy || filteredStudents.length === 0}
                onClick={() => handleBulkMarkWeek('present')}
                className="whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-60"
              >
                เช็คมาทุกคนในมุมมองนี้
              </button>
              <button
                type="button"
                disabled={bulkBusy || filteredStudents.length === 0}
                onClick={() => handleBulkMarkWeek('absent')}
                className="whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100 disabled:opacity-60"
              >
                เช็คขาดทุกคนในมุมมองนี้
              </button>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="teacher-week-select"
                className="whitespace-nowrap text-xs font-medium text-slate-500"
              >
                สัปดาห์ที่แก้ไข:
              </label>
              <select
                id="teacher-week-select"
                value={teacherSelectedWeek}
                onChange={(e) => setTeacherSelectedWeek(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-600"
              >
                {state.weeks.map((w) => (
                  <option key={w.week} value={w.week}>
                    สัปดาห์ {w.week} ({w.thaiLabel}) {w.isFreeCredit ? '· ฟรีมาทุกคน' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-500 tabular-nums">
            สัปดาห์ที่ {displayWeekObj.week} ({displayWeekObj.thaiLabel}): มาเรียน{' '}
            <span className="font-semibold text-emerald-700">{todayStats.present}</span> /{' '}
            {state.students.length} คน
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อ หรือ รหัสนักเรียน..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-600"
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-indigo-200/80 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-blue-50/70 to-sky-50/80 text-xs font-semibold text-indigo-950">
                <th className="px-4 py-3 text-center">ลำดับ</th>
                <th className="px-4 py-3">รหัส</th>
                <th className="px-4 py-3">ชื่อ-สกุล</th>
                <th className="px-4 py-3">ชั้น / ห้อง / เลขที่</th>
                <th className="px-4 py-3 text-right">มาเรียนสะสม</th>
                <th className="px-4 py-3">สถานะสัปดาห์ที่ {displayWeekObj.week}</th>
                <th className="px-4 py-3 text-right">เช็คชื่อ / จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.map((student) => {
                const summary = computeStudentAttendanceSummary(
                  student.id,
                  state.attendance,
                  nowBangkok
                );
                const rec = state.attendance[`${student.id}_${displayWeekObj.week}`];
                const isPresentThisWeek = rec?.status === 'present';
                const isPastOrClosed =
                  !displayWeekObj.isFreeCredit &&
                  (displayWeekObj.date < nowBangkok.isoDate ||
                    (displayWeekObj.date === nowBangkok.isoDate &&
                      nowBangkok.windowStatus === 'after_window'));
                const isAbsent = rec?.status === 'absent' || (!isPresentThisWeek && isPastOrClosed);
                const isSelected = selectedStudentId === student.id;
                const isBusy = checkingStudentId === student.id;

                return (
                  <tr
                    key={student.id}
                    className={`transition-colors hover:bg-slate-50/80 ${
                      isSelected ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-center font-mono text-xs text-slate-500 tabular-nums">
                      {student.order}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700 tabular-nums">
                      {student.id}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onSelectStudent(student.id)}
                        className="text-left font-medium text-slate-900 hover:text-blue-700"
                      >
                        {student.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {student.grade}/{student.room} · เลขที่ {student.number}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <div className="font-semibold text-slate-900">
                        {summary.presentCount}/20{' '}
                        <span className="text-xs font-normal text-slate-500">
                          ({summary.percentOf20.toFixed(0)}%)
                        </span>
                      </div>
                      <div
                        className={`text-[11px] font-medium ${
                          summary.meets80Now
                            ? 'text-emerald-700'
                            : summary.canStillPass80
                              ? 'text-slate-500'
                              : 'text-red-700'
                        }`}
                      >
                        {summary.meets80Now
                          ? 'ผ่านเกณฑ์ 80%'
                          : summary.canStillPass80
                            ? `ต้องการอีก ${Math.max(0, summary.requiredWeeks - summary.presentCount)} ครั้ง`
                            : 'ไม่ถึงเกณฑ์ 80%'}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isPresentThisWeek ? (
                        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          <span>
                            {rec?.source === 'free_credit'
                              ? 'มาเรียน (ฟรีทุกคน)'
                              : rec?.source === 'teacher'
                                ? 'มาเรียน (ครูบันทึก)'
                                : 'มาเรียนแล้ว'}
                          </span>
                        </div>
                      ) : isAbsent ? (
                        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
                          <XCircle className="h-4 w-4 shrink-0" />
                          <span>ขาด / ไม่เข้าชุมนุม</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                          <span>
                            {nowBangkok.isWithinCheckinWindow ? 'รอเช็คชื่อ' : 'ยังไม่ถึงเวลา'}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isTeacher ? (
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              handleTeacherToggleAttendance(student, displayWeekObj.week, 'present')
                            }
                            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              isPresentThisWeek
                                ? 'bg-emerald-700 text-white'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-emerald-50 hover:text-emerald-800'
                            }`}
                          >
                            มา
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              handleTeacherToggleAttendance(student, displayWeekObj.week, 'absent')
                            }
                            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              rec?.status === 'absent'
                                ? 'bg-red-700 text-white'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-red-50 hover:text-red-800'
                            }`}
                          >
                            ขาด
                          </button>
                          <button
                            type="button"
                            onClick={() => setAttendanceModalStudent(student)}
                            title="แก้ไขประวัติเข้าเรียนทั้ง 20 สัปดาห์"
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <CalendarCog className="h-3.5 w-3.5" />
                            <span>20 สัปดาห์</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditStudentModal(student)}
                            title="แก้ไขข้อมูลนักเรียน"
                            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 hover:text-blue-700"
                            aria-label={`แก้ไข ${student.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(student)}
                            title="ลบนักเรียน"
                            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                            aria-label={`ลบ ${student.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={
                            isBusy || isPresentThisWeek || !nowBangkok.isWithinCheckinWindow
                          }
                          onClick={() => handleSelfCheckIn(student)}
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                            isPresentThisWeek
                              ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                              : nowBangkok.isWithinCheckinWindow
                                ? 'bg-blue-700 text-white hover:bg-blue-800'
                                : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
                          }`}
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>
                            {isBusy
                              ? 'กำลังบันทึก...'
                              : isPresentThisWeek
                                ? 'เช็คชื่อแล้ว'
                                : nowBangkok.isWithinCheckinWindow
                                  ? 'เช็คชื่อเข้าชุมนุม'
                                  : 'ปิดรับเช็คชื่อ'}
                          </span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    ไม่พบรายชื่อนักเรียนที่ตรงกับคำค้นหา
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Student Modal */}
      {studentFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {editingPreviousId ? 'แก้ไขข้อมูลนักเรียน' : 'เพิ่มนักเรียนใหม่'}
              </h3>
              <button
                type="button"
                onClick={() => setStudentFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStudentForm} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">ลำดับ *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={formOrder}
                    onChange={(e) => setFormOrder(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">รหัสนักเรียน *</label>
                  <input
                    type="text"
                    required
                    value={formId}
                    onChange={(e) => setFormId(e.target.value)}
                    placeholder="เช่น 29520"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">ชื่อ-สกุล *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="เช่น นายสมชาย ใจดี"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">ชั้น *</label>
                  <input
                    type="text"
                    required
                    value={formGrade}
                    onChange={(e) => setFormGrade(e.target.value)}
                    placeholder="ม.5"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">ห้อง *</label>
                  <input
                    type="text"
                    required
                    value={formRoom}
                    onChange={(e) => setFormRoom(e.target.value)}
                    placeholder="8"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">เลขที่ *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={formNumber}
                    onChange={(e) => setFormNumber(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStudentFormOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingStudent}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {savingStudent ? 'กำลังบันทึก...' : 'บันทึกข้อมูลนักเรียน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Student Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">ยืนยันการลบนักเรียน</h3>
            <p className="mt-2 text-sm text-slate-600">
              ต้องการลบรายชื่อ <strong>{deleteTarget.name}</strong> (รหัส {deleteTarget.id})
              ออกจากห้องเรียนใช่หรือไม่?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={deletingStudent}
                onClick={handleConfirmDeleteStudent}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {deletingStudent ? 'กำลังลบ...' : 'ยืนยันลบ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Per-student 20-week Attendance Editor Modal */}
      {attendanceModalStudent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setAttendanceModalStudent(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="font-mono text-xs text-slate-500 tabular-nums">
                  รหัส {attendanceModalStudent.id} · {attendanceModalStudent.grade}/
                  {attendanceModalStudent.room} เลขที่ {attendanceModalStudent.number}
                </div>
                <h3 className="mt-1 text-lg font-bold text-slate-900">
                  แก้ไขบันทึกการเข้าเรียน 20 สัปดาห์ — {attendanceModalStudent.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAttendanceModalStudent(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {state.weeks.map((week) => {
                const rec = state.attendance[`${attendanceModalStudent.id}_${week.week}`];
                const isPresent = rec?.status === 'present';
                const isAbsent = rec?.status === 'absent';
                const busy = checkingStudentId === attendanceModalStudent.id;

                return (
                  <div
                    key={week.week}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                        สัปดาห์ {week.week} · {week.thaiLabel}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">
                        {week.isFreeCredit ? 'ฟรีมาทุกคน' : week.topic}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          handleTeacherToggleAttendance(attendanceModalStudent, week.week, 'present')
                        }
                        className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                          isPresent
                            ? 'bg-emerald-700 text-white'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-emerald-50'
                        }`}
                      >
                        มา
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          handleTeacherToggleAttendance(attendanceModalStudent, week.week, 'absent')
                        }
                        className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                          isAbsent
                            ? 'bg-red-700 text-white'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-red-50'
                        }`}
                      >
                        ขาด
                      </button>
                      {!week.isFreeCredit && rec && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleTeacherClearWeek(attendanceModalStudent, week.week)}
                          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                        >
                          รีเซ็ต
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
