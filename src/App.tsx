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
  type Submission,
  computeStudentAttendanceSummary,
  getBangkokNowInfo,
} from './shared/classroomData';
import { auth, db, analyticsPromise, testFirestoreConnection } from './firebase';
import {
  buildDefaultAttendanceMap,
  isTeacherUser,
  seedBaselineAssignmentsToFirestore,
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
  { key: 'summary', label: 'สรุปคะแนน 100', icon: GraduationCap },
  { key: 'schedule', label: 'ตาราง 20 สัปดาห์', icon: LayoutGrid },
];

export default function App() {
  const [assignments, setAssignments] = useState<Assignment[]>(INITIAL_ASSIGNMENTS);
  const [attendance, setAttendance] = useState<Record<string, AttendanceRecord>>(() =>
    buildDefaultAttendanceMap()
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

  // Initialize Analytics + test Firestore connection + subscribe real-time listeners
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
        void seedBaselineAssignmentsToFirestore(new Set()).catch(() => {});
      }
    });

    return () => {
      active = false;
      unsubDb();
      unsubAuth();
    };
  }, []);

  // Live Thailand clock ticker (updates every 1s)
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowBangkok(getBangkokNowInfo(new Date()));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const state: ClassroomStatePayload = useMemo(
    () => ({
      students: STUDENTS,
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
    [assignments, attendance, submissions, nowBangkok]
  );

  const selectedStudent = useMemo(() => {
    if (!selectedStudentId) return null;
    return STUDENTS.find((s) => s.id === selectedStudentId) ?? null;
  }, [selectedStudentId]);

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
      const msg = await submitStudentSelfCheckIn(selectedStudent.id);
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

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('attendance')}
            className="whitespace-nowrap shrink-0 text-left text-lg font-bold tracking-tight text-slate-900"
          >
            AI Creative Classroom
          </button>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            {NAV_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-700 font-semibold text-blue-800'
                    : 'border-transparent hover:text-slate-900'
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
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>ออกจากโหมดครู</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowTeacherModal(true)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
              >
                <Shield className="h-3.5 w-3.5" />
                <span>โหมดครูผู้สอน</span>
              </button>
            )}
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto border-t border-slate-100 px-3 py-1.5 md:hidden">
          {NAV_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
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
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium leading-relaxed text-amber-900">
            {firebaseWarning}
          </div>
        )}

        {notification && (
          <div
            role="status"
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${
              notification.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
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

        <section className="space-y-4">
          <div className="grid grid-cols-1 items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-12">
            <div className="flex flex-col justify-between p-6 lg:col-span-7 lg:p-7">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>ชุมนุมสร้างสรรค์ภาพด้วย AI</span>
                  <span aria-hidden="true">·</span>
                  <span>ม.5 ห้อง 8, 9, 13, 14 (20 คน)</span>
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

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label
                      htmlFor="global-student-select"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      เลือกชื่อนักเรียนของคุณ (เพื่อเช็คชื่อ / ดูคะแนน / ส่งใบงาน)
                    </label>
                    <select
                      id="global-student-select"
                      value={selectedStudentId}
                      onChange={(e) => setSelectedStudentId(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-600"
                    >
                      <option value="">-- เลือกชื่อจากรายชื่อ 20 คน --</option>
                      {STUDENTS.map((s) => (
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
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                          : nowBangkok.isWithinCheckinWindow
                            ? 'bg-blue-700 text-white hover:bg-blue-800'
                            : 'cursor-not-allowed border border-slate-200 bg-slate-200/70 text-slate-500'
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
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 pt-2.5 text-xs text-slate-700 tabular-nums">
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
                      <strong className="text-blue-800">
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

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Clock className="h-3.5 w-3.5 text-blue-700" />
                <span>เวลาประเทศไทยขณะนี้</span>
              </div>
              <div className="mt-1.5 font-mono text-lg font-bold text-slate-900 tabular-nums">
                {nowBangkok.timeHHMMSS} น.
              </div>
              <div className="mt-0.5 text-xs text-slate-600">
                {nowBangkok.weekdayThai} · เช็คชื่อ 14:55–15:50 น.
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium text-slate-500">สถานะเช็คชื่อวันนี้</div>
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

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium text-slate-500">เกณฑ์เวลาเรียน 20 สัปดาห์</div>
              <div className="mt-1.5 font-mono text-lg font-bold text-slate-900 tabular-nums">
                ≥ 80% <span className="text-xs font-normal text-slate-500">(16/20 ครั้ง)</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                ฟรี 3 สัปดาห์ (5, 12, 19 พ.ย. 69)
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium text-slate-500">คะแนนเก็บใบงานทั้งหมด</div>
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
          <ScheduleView state={state} nowBangkok={nowBangkok} />
        )}
      </main>

      <footer className="mt-12 border-t border-slate-200 bg-white py-5">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-xs text-slate-500 sm:flex-row sm:px-6">
          <span>AI Creative Classroom · ชุมนุมสร้างสรรค์ภาพด้วย AI (ม.5)</span>
          <span className="tabular-nums">
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
          showNotification(`เข้าสู่โหมดครูผู้สอน (${email}) เรียบร้อยแล้ว`, 'success');
        }}
      />
    </div>
  );
}
