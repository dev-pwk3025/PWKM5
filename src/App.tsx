import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileImage,
  GraduationCap,
  LayoutGrid,
  LogOut,
  Shield,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  INITIAL_ASSIGNMENTS,
  SESSION_WEEKS,
  STUDENTS,
  type Assignment,
  type AttendanceRecord,
  type BangkokNowInfo,
  type ClassroomStatePayload,
  type Student,
  type Submission,
  computeStudentAttendanceSummary,
  getBangkokNowInfo,
} from './shared/classroomData';
import { auth, db, analyticsPromise, testFirestoreConnection } from './firebase';
import {
  buildDefaultAttendanceMap,
  isTeacherUser,
  seedBaselineClassroomIfNeeded,
  submitStudentSelfCheckIn,
  subscribeClassroomCollections,
} from './services/classroomFirebase';
import { AttendanceCheckinView } from './components/AttendanceCheckinView';
import { AssignmentsView } from './components/AssignmentsView';
import { SummaryGradebookView } from './components/SummaryGradebookView';
import { ScheduleView } from './components/ScheduleView';
import { TeacherAuthModal } from './components/TeacherAuthModal';

type TabKey = 'attendance' | 'assignments' | 'summary' | 'schedule';

const NAV_TABS: { key: TabKey; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'attendance', label: 'เช็คชื่อเรียน', icon: CalendarCheck },
  { key: 'assignments', label: 'ใบงาน & ส่งภาพ', icon: FileImage },
  { key: 'summary', label: 'รายงานสรุป 100 คะแนน', icon: GraduationCap },
  { key: 'schedule', label: 'ตาราง 20 สัปดาห์', icon: LayoutGrid },
];

export default function App() {
  const [students, setStudents] = useState<Student[]>(STUDENTS);
  const [assignments, setAssignments] = useState<Assignment[]>(INITIAL_ASSIGNMENTS);
  const [attendance, setAttendance] = useState<Record<string, AttendanceRecord>>(() =>
    buildDefaultAttendanceMap(STUDENTS)
  );
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const [firebaseWarning, setFirebaseWarning] = useState('');

  const [activeTab, setActiveTab] = useState<TabKey>('attendance');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [isTeacher, setIsTeacher] = useState(false);
  const [teacherEmail, setTeacherEmail] = useState<string | null>(null);
  const [showTeacherModal, setShowTeacherModal] = useState(false);
  const [nowBangkok, setNowBangkok] = useState<BangkokNowInfo>(() => getBangkokNowInfo(new Date()));
  const [notification, setNotification] = useState<{
    message: string;
    tone: 'success' | 'error';
  } | null>(null);
  const [quickCheckingIn, setQuickCheckingIn] = useState(false);

  const showNotification = useCallback((message: string, tone: 'success' | 'error') => {
    setNotification({ message, tone });
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    void analyticsPromise;
    let active = true;

    testFirestoreConnection().then((res) => {
      if (!active) return;
      if (res.ok) {
        setFirebaseConnected(true);
      } else if (res.message) {
        setFirebaseWarning(res.message);
      }
    });

    const unsubDb = subscribeClassroomCollections({
      onStudents: (list) => {
        if (!active) return;
        setStudents(list);
      },
      onAssignments: (list) => {
        if (!active) return;
        setAssignments(list);
        setFirebaseConnected(true);
        setFirebaseWarning('');
      },
      onAttendance: (map) => {
        if (!active) return;
        setAttendance(map);
      },
      onSubmissions: (map) => {
        if (!active) return;
        setSubmissions(map);
      },
      onError: (err) => {
        if (!active) return;
        const msg = err.message || '';
        if (msg.includes('Missing or insufficient permissions') || msg.includes('permission-denied')) {
          setFirebaseWarning(
            'Firestore ยังไม่อนุญาตสิทธิ์อ่าน/เขียน — กรุณานำกติกาจากไฟล์ firestore.rules ไปวางใน Firebase Console > Firestore Database > Rules'
          );
        } else {
          setFirebaseWarning('กำลังทำงานในโหมดข้อมูลเริ่มต้น (ไม่สามารถซิงค์ Firestore ชั่วคราว)');
        }
      },
    });

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        setIsTeacher(false);
        setTeacherEmail(null);
        return;
      }
      let isAdminDoc = false;
      try {
        const snap = await getDoc(doc(db, 'admins', user.uid));
        isAdminDoc = snap.exists();
      } catch {
        isAdminDoc = false;
      }
      const allowed = isTeacherUser(user.email, isAdminDoc);
      setIsTeacher(allowed);
      setTeacherEmail(allowed ? user.email : null);
      if (allowed) {
        void seedBaselineClassroomIfNeeded().catch(() => {});
      }
    });

    return () => {
      active = false;
      unsubDb();
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowBangkok(getBangkokNowInfo(new Date()));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const state: ClassroomStatePayload = useMemo(
    () => ({
      students,
      weeks: SESSION_WEEKS,
      assignments,
      attendance,
      submissions,
      teacherAuth: {
        hasConfiguredPasscode: true,
        usesEnvPasscode: false,
      },
      serverNowBangkok: nowBangkok,
    }),
    [students, assignments, attendance, submissions, nowBangkok]
  );

  const selectedStudent = useMemo(() => {
    if (!selectedStudentId) return null;
    return students.find((s) => s.id === selectedStudentId) ?? null;
  }, [students, selectedStudentId]);

  const selectedStudentStats = useMemo(() => {
    if (!selectedStudent) return null;
    const att = computeStudentAttendanceSummary(selectedStudent.id, attendance, nowBangkok);
    const published = assignments.filter((a) => a.isPublished);
    const maxScore = published.reduce((acc, a) => acc + a.maxScore, 0);
    const earnedScore = published.reduce((acc, a) => {
      const sub = submissions[`${a.id}_${selectedStudent.id}`];
      return acc + (sub?.score ?? 0);
    }, 0);
    const submittedCount = published.filter((a) =>
      Boolean(submissions[`${a.id}_${selectedStudent.id}`])
    ).length;

    const currentWeekNumber = nowBangkok.currentWeek?.week;
    const checkedToday = currentWeekNumber
      ? attendance[`${selectedStudent.id}_${currentWeekNumber}`]?.status === 'present'
      : false;

    return {
      attendance: att,
      maxScore,
      earnedScore,
      submittedCount,
      totalAssignments: published.length,
      checkedToday,
    };
  }, [selectedStudent, attendance, assignments, submissions, nowBangkok]);

  async function handleQuickCheckIn() {
    if (!selectedStudent) return;
    setQuickCheckingIn(true);
    try {
      const msg = await submitStudentSelfCheckIn(selectedStudent.id, students);
      showNotification(msg, 'success');
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'ไม่สามารถเช็คชื่อได้';
      showNotification(
        raw.includes('permission-denied')
          ? 'ยังไม่ได้ตั้งค่า Firestore Rules ใน Firebase Console'
          : raw,
        'error'
      );
    } finally {
      setQuickCheckingIn(false);
    }
  }

  async function handleTeacherLogout() {
    await signOut(auth);
    setIsTeacher(false);
    setTeacherEmail(null);
    showNotification('ออกจากโหมดครูผู้สอนแล้ว', 'success');
  }

  const distinctRooms = useMemo(
    () =>
      Array.from(new Set(students.map((s) => s.room)))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .join(', '),
    [students]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-[#F8FAFC] to-indigo-50/70 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-indigo-100 bg-white/95 shadow-xs backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:gap-8 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('attendance')}
            className="flex shrink-0 flex-col items-start text-left"
          >
            <span className="whitespace-nowrap bg-gradient-to-r from-blue-700 via-indigo-700 to-cyan-600 bg-clip-text text-lg font-bold tracking-tight text-transparent sm:text-xl">
              AI Creative Classroom
            </span>
            <span className="mt-1 inline-flex items-center whitespace-nowrap rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 p-[1.5px] shadow-xs">
              <span className="rounded-[6.5px] bg-gradient-to-r from-blue-50 via-indigo-50 to-cyan-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-900">
                ชุมนุมสื่อสร้างสรรค์ ม.5
              </span>
            </span>
          </button>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            {NAV_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap shrink-0 border-b-2 py-1.5 transition-colors ${
                  activeTab === tab.key
                    ? 'border-indigo-600 font-semibold text-indigo-800'
                    : 'border-transparent hover:text-indigo-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="shrink-0">
            {isTeacher ? (
              <button
                type="button"
                onClick={handleTeacherLogout}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-indigo-200 bg-indigo-50/70 px-4 py-2 text-xs font-semibold text-indigo-900 transition-colors hover:bg-indigo-100"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>ออกจากโหมดครู</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowTeacherModal(true)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-gradient-to-r from-slate-900 to-indigo-950 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-95"
              >
                <Shield className="h-3.5 w-3.5" />
                <span>โหมดครูผู้สอน</span>
              </button>
            )}
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto border-t border-indigo-100/80 bg-indigo-50/30 px-3 py-1.5 md:hidden">
          {NAV_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        {firebaseWarning && (
          <div className="no-print rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-medium leading-relaxed text-amber-900 shadow-xs">
            {firebaseWarning}
          </div>
        )}

        {notification && (
          <div
            role="status"
            className={`no-print flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-xs ${
              notification.tone === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-red-300 bg-red-50 text-red-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {notification.tone === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-red-600" />
              )}
              <span>{notification.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="text-xs font-semibold underline"
            >
              ปิด
            </button>
          </div>
        )}

        <section className="no-print space-y-4">
          <div className="rounded-2xl bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-600 p-[2px] shadow-sm">
            <div className="grid grid-cols-1 items-stretch overflow-hidden rounded-[14px] bg-white lg:grid-cols-12">
              <div className="flex flex-col justify-between p-6 lg:col-span-7 lg:p-7">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="font-semibold text-indigo-700">ชุมนุมสื่อสร้างสรรค์ ม.5</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      ม.5 ห้อง {distinctRooms || '-'} ({students.length} คน)
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className={firebaseConnected ? 'font-medium text-emerald-700' : 'text-slate-500'}>
                      {firebaseConnected ? 'เชื่อมต่อ Firebase เรียลไทม์' : 'กำลังเชื่อมต่อ Firebase...'}
                    </span>
                    {teacherEmail && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-blue-700">ครูผู้สอน: {teacherEmail}</span>
                      </>
                    )}
                  </div>
                  <h1 className="mt-2 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    ระบบเช็คชื่อและส่งผลงานสร้างภาพ AI
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                    เช็คชื่อด้วยตนเองทุกวันพฤหัสบดี เวลา 14:55 – 15:50 น. รวม 20 สัปดาห์
                    (ฟรีวันที่ 5, 12, 19 พ.ย. 69 · เริ่มเช็คชื่อจริง 26 พ.ย. 69) เกณฑ์ผ่านเวลาเรียน
                    80% และเก็บคะแนนใบงาน 5 ชิ้นรวม 100 คะแนน
                  </p>
                </div>

                <div className="mt-5 rounded-xl border border-indigo-200/80 bg-gradient-to-br from-blue-50/70 via-indigo-50/50 to-cyan-50/60 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <label
                        htmlFor="global-student-select"
                        className="block text-xs font-semibold text-indigo-950"
                      >
                        เลือกชื่อนักเรียนของคุณ (เพื่อเช็คชื่อ / ดูคะแนน / ส่งใบงาน)
                      </label>
                      <select
                        id="global-student-select"
                        value={selectedStudentId}
                        onChange={(e) => setSelectedStudentId(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-600"
                      >
                        <option value="">-- เลือกชื่อจากรายชื่อ {students.length} คน --</option>
                        {students.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.order}. [{s.id}] {s.name} ({s.grade}/{s.room} เลขที่ {s.number})
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedStudent && (
                      <button
                        type="button"
                        disabled={
                          quickCheckingIn ||
                          !nowBangkok.isWithinCheckinWindow ||
                          Boolean(selectedStudentStats?.checkedToday)
                        }
                        onClick={handleQuickCheckIn}
                        className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2.5 text-xs font-semibold transition-colors ${
                          selectedStudentStats?.checkedToday
                            ? 'border border-emerald-300 bg-emerald-50 text-emerald-800'
                            : nowBangkok.isWithinCheckinWindow
                              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs hover:opacity-95'
                              : 'cursor-not-allowed border border-slate-200 bg-slate-200/80 text-slate-500'
                        }`}
                      >
                        <UserCheck className="h-4 w-4" />
                        <span>
                          {quickCheckingIn
                            ? 'กำลังเช็คชื่อ...'
                            : selectedStudentStats?.checkedToday
                              ? 'เช็คชื่อวันนี้แล้ว'
                              : nowBangkok.isWithinCheckinWindow
                                ? 'เช็คชื่อเข้าชุมนุมทันที'
                                : 'ปิดรับเช็คชื่อ'}
                        </span>
                      </button>
                    )}
                  </div>

                  {selectedStudent && selectedStudentStats && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-indigo-200/70 pt-2.5 text-xs text-slate-700 tabular-nums">
                      <span>
                        เวลาเรียน:{' '}
                        <strong className="text-slate-900">
                          {selectedStudentStats.attendance.presentCount}/20 สัปดาห์ (
                          {selectedStudentStats.attendance.percentOf20.toFixed(0)}%)
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        ส่งใบงานแล้ว:{' '}
                        <strong className="text-slate-900">
                          {selectedStudentStats.submittedCount}/
                          {selectedStudentStats.totalAssignments} ชิ้น
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        คะแนนรวม:{' '}
                        <strong className="text-indigo-800">
                          {selectedStudentStats.earnedScore}/{selectedStudentStats.maxScore} คะแนน
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="relative min-h-[200px] bg-slate-100 lg:col-span-5">
                <img
                  src="/src/assets/images/classroom_ai_studio_banner_1795676944840.jpg"
                  alt="ห้องเรียนสร้างสรรค์ภาพด้วย AI"
                  referrerPolicy="no-referrer"
                  className="h-56 w-full object-cover lg:h-full"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="overflow-hidden rounded-xl border border-sky-200 bg-white shadow-xs">
              <div className="h-1 bg-gradient-to-r from-sky-500 to-blue-600" />
              <div className="p-4">
                <div className="flex items-center gap-1.5 text-xs font-medium text-sky-800">
                  <Clock className="h-3.5 w-3.5 text-sky-600" />
                  <span>เวลาประเทศไทยขณะนี้</span>
                </div>
                <div className="mt-1.5 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {nowBangkok.timeHHMMSS} น.
                </div>
                <div className="mt-0.5 text-xs text-slate-600">
                  {nowBangkok.weekdayThai} · เช็คชื่อ 14:55–15:50 น.
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-xs">
              <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
              <div className="p-4">
                <div className="text-xs font-medium text-emerald-800">สถานะเช็คชื่อวันนี้</div>
                <div
                  className={`mt-1.5 text-base font-bold ${
                    nowBangkok.isWithinCheckinWindow ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {nowBangkok.isWithinCheckinWindow
                    ? 'เปิดให้เช็คชื่อ'
                    : nowBangkok.isThursday
                      ? 'นอกเวลา 14:55–15:50'
                      : 'วันอื่นงดเช็คชื่อ'}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {nowBangkok.currentWeek
                    ? `สัปดาห์ที่ ${nowBangkok.currentWeek.week} (${nowBangkok.currentWeek.thaiLabel})`
                    : 'เปิดเฉพาะวันพฤหัสบดี'}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-violet-200 bg-white shadow-xs">
              <div className="h-1 bg-gradient-to-r from-violet-500 to-indigo-600" />
              <div className="p-4">
                <div className="text-xs font-medium text-violet-800">เกณฑ์เวลาเรียน 20 สัปดาห์</div>
                <div className="mt-1.5 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  ≥ 80% <span className="text-xs font-normal text-slate-500">(16/20 ครั้ง)</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  ฟรี 3 สัปดาห์ (5, 12, 19 พ.ย. 69)
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xs">
              <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
              <div className="p-4">
                <div className="text-xs font-medium text-amber-800">คะแนนเก็บใบงานทั้งหมด</div>
                <div className="mt-1.5 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {assignments
                    .filter((a) => a.isPublished)
                    .reduce((s, a) => s + a.maxScore, 0)}{' '}
                  คะแนน
                </div>
                <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                  {assignments.filter((a) => a.isPublished).length} ใบงาน · ส่งภาพเรียลไทม์
                </div>
              </div>
            </div>
          </div>
        </section>

        {activeTab === 'attendance' && (
          <AttendanceCheckinView
            state={state}
            nowBangkok={nowBangkok}
            selectedStudentId={selectedStudentId}
            onSelectStudent={setSelectedStudentId}
            isTeacher={isTeacher}
            onNotify={showNotification}
          />
        )}

        {activeTab === 'assignments' && (
          <AssignmentsView
            state={state}
            selectedStudentId={selectedStudentId}
            onSelectStudent={setSelectedStudentId}
            isTeacher={isTeacher}
            onNotify={showNotification}
          />
        )}

        {activeTab === 'summary' && (
          <SummaryGradebookView
            state={state}
            nowBangkok={nowBangkok}
            selectedStudentId={selectedStudentId}
            onSelectStudent={setSelectedStudentId}
          />
        )}

        {activeTab === 'schedule' && (
          <ScheduleView
            state={state}
            nowBangkok={nowBangkok}
            isTeacher={isTeacher}
            onNotify={showNotification}
          />
        )}
      </main>

      <footer className="mt-12 border-t border-indigo-200/80 bg-gradient-to-r from-white via-indigo-50/40 to-sky-50/50 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-center text-xs sm:flex-row sm:px-6 sm:text-left">
          <div className="space-y-0.5">
            <div className="font-semibold text-indigo-950">
              AI Creative Classroom · ชุมนุมสื่อสร้างสรรค์ ม.5
            </div>
            <div className="font-medium text-blue-800">
              โดย ครูเอกอภิสิทธิ์ ดอกศรีจันทร์ ครูชำนาญการพิเศษ โรงเรียนประสาทวิทยาคาร
            </div>
          </div>
          <span className="text-slate-500 tabular-nums">
            เช็คชื่อทุกวันพฤหัสบดี 14:55–15:50 น. · เกณฑ์เวลาเรียน 80% (20 สัปดาห์) · คะแนนงาน 100 คะแนน
          </span>
        </div>
      </footer>

      <TeacherAuthModal
        isOpen={showTeacherModal}
        onClose={() => setShowTeacherModal(false)}
        onAuthenticated={(email) => {
          setIsTeacher(true);
          setTeacherEmail(email);
          void seedBaselineClassroomIfNeeded().catch(() => {});
          showNotification(`เข้าสู่โหมดครูผู้สอน (${email}) เรียบร้อยแล้ว`, 'success');
        }}
      />
    </div>
  );
}
