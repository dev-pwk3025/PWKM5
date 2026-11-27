import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  auth,
  db,
  storage,
  OperationType,
  handleFirestoreError,
} from '../firebase';
import {
  INITIAL_ASSIGNMENTS,
  SESSION_WEEKS,
  STUDENTS,
  getBangkokNowInfo,
  type Assignment,
  type AttendanceRecord,
  type Student,
  type Submission,
} from '../shared/classroomData';

export const TEACHER_EMAILS = new Set(['aek-apisit@pwk.ac.th']);

export function isTeacherUser(email: string | null | undefined, isAdminDoc: boolean): boolean {
  if (!email) return false;
  return TEACHER_EMAILS.has(email.toLowerCase()) || isAdminDoc;
}

export function buildDefaultAttendanceMap(studentsList: Student[] = STUDENTS): Record<string, AttendanceRecord> {
  const map: Record<string, AttendanceRecord> = {};
  for (const week of SESSION_WEEKS) {
    if (week.isFreeCredit) {
      for (const student of studentsList) {
        map[`${student.id}_${week.week}`] = {
          studentId: student.id,
          week: week.week,
          status: 'present',
          checkedAt: `${week.date}T15:00:00+07:00`,
          source: 'free_credit',
        };
      }
    }
  }
  return map;
}

export function subscribeClassroomCollections(callbacks: {
  onStudents: (students: Student[]) => void;
  onAssignments: (assignments: Assignment[]) => void;
  onAttendance: (attendance: Record<string, AttendanceRecord>) => void;
  onSubmissions: (submissions: Record<string, Submission>) => void;
  onError: (err: Error) => void;
}): Unsubscribe {
  let rosterSeeded = false;
  let latestStudents: Student[] = STUDENTS;
  let rawAttendanceDocs: Record<string, AttendanceRecord> = {};

  const emitAttendance = () => {
    const map = buildDefaultAttendanceMap(latestStudents);
    for (const [id, rec] of Object.entries(rawAttendanceDocs)) {
      map[id] = rec;
    }
    callbacks.onAttendance(map);
  };

  const unsubRosterSetting = onSnapshot(
    doc(db, 'settings', 'roster'),
    (snap) => {
      rosterSeeded = snap.exists() && Boolean(snap.data()?.seeded);
    },
    () => {
      // Non-fatal if settings/roster isn't readable yet
    }
  );

  const unsubStudents = onSnapshot(
    collection(db, 'students'),
    (snapshot) => {
      if (snapshot.empty && !rosterSeeded) {
        latestStudents = STUDENTS;
        callbacks.onStudents(STUDENTS);
        emitAttendance();
        return;
      }
      const list = snapshot.docs
        .map((d) => {
          const data = d.data() as Student;
          return {
            order: Number(data.order) || 0,
            id: String(data.id || d.id),
            name: String(data.name || ''),
            grade: String(data.grade || 'ม.5'),
            room: String(data.room || ''),
            number: Number(data.number) || 0,
          };
        })
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      latestStudents = list;
      callbacks.onStudents(list);
      emitAttendance();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'students');
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const unsubAssignments = onSnapshot(
    collection(db, 'assignments'),
    (snapshot) => {
      const mergedMap = new Map<string, Assignment>();
      for (const a of INITIAL_ASSIGNMENTS) {
        mergedMap.set(a.id, a);
      }
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data() as Assignment;
        mergedMap.set(docSnap.id, { ...data, id: docSnap.id });
      }
      const list = Array.from(mergedMap.values()).sort((a, b) => a.order - b.order);
      callbacks.onAssignments(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'assignments');
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const unsubAttendance = onSnapshot(
    collection(db, 'attendance'),
    (snapshot) => {
      const docsMap: Record<string, AttendanceRecord> = {};
      for (const docSnap of snapshot.docs) {
        docsMap[docSnap.id] = docSnap.data() as AttendanceRecord;
      }
      rawAttendanceDocs = docsMap;
      emitAttendance();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'attendance');
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const unsubSubmissions = onSnapshot(
    collection(db, 'submissions'),
    (snapshot) => {
      const map: Record<string, Submission> = {};
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data() as Submission;
        map[docSnap.id] = { ...data, id: docSnap.id };
      }
      callbacks.onSubmissions(map);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'submissions');
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  return () => {
    unsubRosterSetting();
    unsubStudents();
    unsubAssignments();
    unsubAttendance();
    unsubSubmissions();
  };
}

export async function seedBaselineClassroomIfNeeded(): Promise<void> {
  if (!auth.currentUser) return;
  try {
    const rosterSettingSnap = await getDoc(doc(db, 'settings', 'roster'));
    if (!rosterSettingSnap.exists()) {
      const existingStudents = await getDocs(collection(db, 'students'));
      const batch = writeBatch(db);
      if (existingStudents.empty) {
        for (const student of STUDENTS) {
          batch.set(doc(db, 'students', student.id), student);
        }
      }
      batch.set(doc(db, 'settings', 'roster'), {
        seeded: true,
        updatedAt: new Date().toISOString(),
      });
      await batch.commit();
    }

    const existingAssignments = await getDocs(collection(db, 'assignments'));
    const existingIds = new Set(existingAssignments.docs.map((d) => d.id));
    for (const assignment of INITIAL_ASSIGNMENTS) {
      if (!existingIds.has(assignment.id)) {
        await setDoc(doc(db, 'assignments', assignment.id), assignment);
      }
    }
  } catch {
    // Rules or network issue handled by caller listeners
  }
}

export async function teacherSaveStudent(student: Student, previousId?: string): Promise<void> {
  if (!auth.currentUser) throw new Error('กรุณาเข้าสู่ระบบครูผู้สอนด้วย Google ก่อน');
  const cleanId = student.id.trim();
  if (!/^[a-zA-Z0-9_-]{1,20}$/.test(cleanId)) {
    throw new Error('รหัสนักเรียนต้องเป็นตัวเลขหรือตัวอักษรภาษาอังกฤษ 1–20 ตัว');
  }
  const cleanName = student.name.trim().slice(0, 160);
  if (!cleanName) throw new Error('กรุณากรอกชื่อ-สกุลนักเรียน');

  const payload: Student = {
    order: Math.max(1, Math.round(Number(student.order) || 1)),
    id: cleanId,
    name: cleanName,
    grade: student.grade.trim().slice(0, 20) || 'ม.5',
    room: student.room.trim().slice(0, 20) || '1',
    number: Math.max(1, Math.round(Number(student.number) || 1)),
  };

  try {
    await seedBaselineClassroomIfNeeded();
    const batch = writeBatch(db);
    batch.set(doc(db, 'students', payload.id), payload);
    if (previousId && previousId !== payload.id) {
      batch.delete(doc(db, 'students', previousId));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `students/${payload.id}`);
  }
}

export async function teacherDeleteStudent(studentId: string): Promise<void> {
  if (!auth.currentUser) throw new Error('กรุณาเข้าสู่ระบบครูผู้สอนด้วย Google ก่อน');
  try {
    await seedBaselineClassroomIfNeeded();
    await deleteDoc(doc(db, 'students', studentId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `students/${studentId}`);
  }
}

export async function submitStudentSelfCheckIn(
  studentId: string,
  studentsList: Student[] = STUDENTS
): Promise<string> {
  const student = studentsList.find((s) => s.id === studentId);
  if (!student) throw new Error('ไม่พบข้อมูลนักเรียนที่เลือก');

  const nowInfo = getBangkokNowInfo(new Date());
  if (!nowInfo.isThursday) {
    throw new Error(
      `ไม่สามารถเช็คชื่อได้: วันนี้${nowInfo.weekdayThai} เปิดเช็คชื่อเฉพาะวันพฤหัสบดี เวลา 14:55 – 15:50 น.`
    );
  }
  if (!nowInfo.currentWeek) {
    throw new Error('วันพฤหัสบดีนี้ไม่อยู่ในช่วง 20 สัปดาห์ของตารางชุมนุม');
  }
  if (nowInfo.currentWeek.isFreeCredit) {
    return `สัปดาห์ที่ ${nowInfo.currentWeek.week} (${nowInfo.currentWeek.thaiLabel}) บันทึกมาเรียนฟรีทุกคนแล้ว`;
  }
  if (!nowInfo.isWithinCheckinWindow) {
    throw new Error(
      `อยู่นอกเวลาเช็คชื่อ (${nowInfo.timeHHMM} น.) — เช็คชื่อได้เฉพาะ 14:55 – 15:50 น.`
    );
  }

  const recordId = `${student.id}_${nowInfo.currentWeek.week}`;
  const payload: AttendanceRecord = {
    studentId: student.id,
    week: nowInfo.currentWeek.week,
    status: 'present',
    source: 'self_checkin',
    checkedAt: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'attendance', recordId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attendance/${recordId}`);
  }

  return `เช็คชื่อสำเร็จ! ${student.name} (สัปดาห์ที่ ${nowInfo.currentWeek.week} เวลา ${nowInfo.timeHHMM} น.)`;
}

export async function teacherSetAttendance(
  studentId: string,
  week: number,
  status: 'present' | 'absent'
): Promise<void> {
  if (!auth.currentUser) throw new Error('กรุณาเข้าสู่ระบบครูผู้สอนด้วย Google ก่อน');
  const recordId = `${studentId}_${week}`;
  const payload: AttendanceRecord = {
    studentId,
    week,
    status,
    source: 'teacher',
    checkedAt: new Date().toISOString(),
  };
  try {
    await setDoc(doc(db, 'attendance', recordId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attendance/${recordId}`);
  }
}

export async function teacherClearAttendance(studentId: string, week: number): Promise<void> {
  if (!auth.currentUser) throw new Error('กรุณาเข้าสู่ระบบครูผู้สอนด้วย Google ก่อน');
  const recordId = `${studentId}_${week}`;
  try {
    await deleteDoc(doc(db, 'attendance', recordId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `attendance/${recordId}`);
  }
}

export async function teacherBulkSetWeekAttendance(
  studentsList: Student[],
  week: number,
  status: 'present' | 'absent'
): Promise<void> {
  if (!auth.currentUser) throw new Error('กรุณาเข้าสู่ระบบครูผู้สอนด้วย Google ก่อน');
  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();
    for (const student of studentsList) {
      const recordId = `${student.id}_${week}`;
      batch.set(doc(db, 'attendance', recordId), {
        studentId: student.id,
        week,
        status,
        source: 'teacher',
        checkedAt: nowIso,
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attendance/week_${week}`);
  }
}

export async function submitStudentWorksheet(params: {
  studentId: string;
  studentsList: Student[];
  assignment: Assignment;
  answers: Record<string, string>;
  promptText: string;
  imageFile: File | null;
  existingSubmission?: Submission;
}): Promise<string> {
  const { studentId, studentsList, assignment, answers, promptText, imageFile, existingSubmission } =
    params;
  const student = studentsList.find((s) => s.id === studentId);
  if (!student) throw new Error('กรุณาเลือกชื่อนักเรียนก่อนส่งงาน');

  let imageUrl = existingSubmission?.imageUrl ?? null;
  let imageOriginalName = existingSubmission?.imageOriginalName ?? null;

  if (imageFile) {
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(imageFile.type)) {
      throw new Error('รองรับเฉพาะไฟล์ภาพ PNG, JPG, WEBP หรือ GIF เท่านั้น');
    }
    if (imageFile.size > 5 * 1024 * 1024) {
      throw new Error('ขนาดไฟล์ภาพต้องไม่เกิน 5 MB');
    }

    const ext = imageFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const storagePath = `submissions/${assignment.id}/${studentId}_${Date.now()}.${ext}`;
    const storageRef = ref(storage, storagePath);

    try {
      const snap = await uploadBytes(storageRef, imageFile, {
        contentType: imageFile.type,
      });
      imageUrl = await getDownloadURL(snap.ref);
      imageOriginalName = imageFile.name;
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code.includes('unauthorized') || code.includes('permission')) {
        throw new Error(
          'ยังไม่ได้เปิดสิทธิ์อัปโหลดใน Firebase Storage (กรุณาตั้งค่า Storage Rules ใน Firebase Console)'
        );
      }
      throw new Error('อัปโหลดไฟล์ภาพไปยัง Firebase Storage ไม่สำเร็จ กรุณาตรวจสอบการเปิดใช้งาน Storage');
    }
  }

  if (!imageUrl) {
    throw new Error('กรุณาแนบไฟล์ภาพผลงานก่อนกดส่งใบงาน');
  }

  const submissionId = `${assignment.id}_${student.id}`;
  const submittedAt = new Date().toISOString();

  if (existingSubmission) {
    try {
      await updateDoc(doc(db, 'submissions', submissionId), {
        answers,
        promptText: promptText.trim().slice(0, 4000),
        imageUrl,
        imageOriginalName,
        submittedAt,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `submissions/${submissionId}`);
    }
  } else {
    const newSub: Submission = {
      id: submissionId,
      assignmentId: assignment.id,
      studentId: student.id,
      answers,
      promptText: promptText.trim().slice(0, 4000),
      imageUrl,
      imageOriginalName,
      score: null,
      feedback: '',
      submittedAt,
      gradedAt: null,
    };
    try {
      await setDoc(doc(db, 'submissions', submissionId), newSub);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `submissions/${submissionId}`);
    }
  }

  return `ส่ง${assignment.title} ลง Firebase เรียบร้อยแล้ว`;
}

export async function teacherGradeSubmission(params: {
  assignment: Assignment;
  studentId: string;
  score: number | null;
  feedback: string;
  existingSubmission?: Submission;
}): Promise<void> {
  if (!auth.currentUser) throw new Error('กรุณาเข้าสู่ระบบครูผู้สอนด้วย Google ก่อน');
  const { assignment, studentId, score, feedback, existingSubmission } = params;
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > assignment.maxScore)) {
    throw new Error(`คะแนนต้องอยู่ระหว่าง 0 ถึง ${assignment.maxScore}`);
  }

  const submissionId = `${assignment.id}_${studentId}`;
  const cleanFeedback = feedback.trim().slice(0, 1000);
  const nowIso = new Date().toISOString();

  if (existingSubmission) {
    try {
      await updateDoc(doc(db, 'submissions', submissionId), {
        score,
        feedback: cleanFeedback,
        gradedAt: nowIso,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `submissions/${submissionId}`);
    }
  } else {
    const record: Submission = {
      id: submissionId,
      assignmentId: assignment.id,
      studentId,
      answers: {},
      promptText: '',
      imageUrl: null,
      imageOriginalName: null,
      score,
      feedback: cleanFeedback,
      submittedAt: nowIso,
      gradedAt: nowIso,
    };
    try {
      await setDoc(doc(db, 'submissions', submissionId), record);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `submissions/${submissionId}`);
    }
  }
}

export async function teacherCreateAssignment(params: {
  nextOrder: number;
  title: string;
  subtitle: string;
  mission: string;
  samplePrompt: string;
  maxScore: number;
}): Promise<Assignment> {
  if (!auth.currentUser) throw new Error('กรุณาเข้าสู่ระบบครูผู้สอนด้วย Google ก่อน');
  const id = `worksheet-${Date.now()}`;
  const assignment: Assignment = {
    id,
    order: params.nextOrder,
    title: params.title.trim().slice(0, 180),
    subtitle: params.subtitle.trim().slice(0, 240) || 'ภารกิจมอบหมายเพิ่มเติมแบบเรียลไทม์',
    mission: params.mission.trim().slice(0, 1500),
    description: params.mission.trim().slice(0, 1500),
    ...(params.samplePrompt.trim()
      ? { samplePrompt: params.samplePrompt.trim().slice(0, 1500) }
      : {}),
    fields: [
      {
        key: 'notes',
        label: 'คำอธิบายผลงาน / แนวคิด',
        placeholder: 'อธิบายแนวคิดหรือขั้นตอนการสร้างภาพของนักเรียน',
        multiline: true,
      },
    ],
    maxScore: Math.round(params.maxScore),
    isPublished: true,
    createdAt: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'assignments', id), assignment);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `assignments/${id}`);
  }
  return assignment;
}
