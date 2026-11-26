import React, { useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { ShieldCheck, X } from 'lucide-react';
import { auth, db, googleProvider } from '../firebase';
import { isTeacherUser } from '../services/classroomFirebase';

interface TeacherAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (email: string) => void;
}

export const TeacherAuthModal: React.FC<TeacherAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
}) => {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  async function handleGoogleSignIn() {
    setError('');
    setSubmitting(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const user = cred.user;
      let isAdminDoc = false;
      try {
        const adminSnap = await getDoc(doc(db, 'admins', user.uid));
        isAdminDoc = adminSnap.exists();
      } catch {
        isAdminDoc = false;
      }

      if (!isTeacherUser(user.email, isAdminDoc)) {
        await signOut(auth);
        setError(
          `บัญชี ${user.email ?? ''} ไม่มีสิทธิ์ครูผู้สอน (กรุณาเข้าสู่ระบบด้วยอีเมลครูผู้สอน aek-apisit@pwk.ac.th)`
        );
        return;
      }

      onAuthenticated(user.email || 'ครูผู้สอน');
      onClose();
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/unauthorized-domain') {
        setError(
          `โดเมน ${window.location.hostname} ยังไม่ได้รับอนุญาตใน Firebase Authentication — กรุณาเพิ่มโดเมนนี้ใน Firebase Console > Authentication > Settings > Authorized domains`
        );
      } else if (code === 'auth/popup-closed-by-user') {
        setError('ปิดหน้าต่างเข้าสู่ระบบก่อนเสร็จสิ้น');
      } else if (code === 'auth/operation-not-allowed') {
        setError(
          'กรุณาเปิดใช้งาน Google Sign-In ใน Firebase Console > Authentication > Sign-in method ก่อนใช้งาน'
        );
      } else {
        setError('ไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-auth-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 id="teacher-auth-title" className="text-lg font-bold text-slate-900">
                เข้าสู่โหมดครูผู้สอน
              </h2>
              <p className="text-xs text-slate-500">
                ยืนยันตัวตนด้วยบัญชี Google ของครูผู้สอน (Firebase Auth)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-600">
            สิทธิ์ครูผู้สอนใช้สำหรับ <strong>ให้คะแนนใบงาน 100 คะแนน</strong>,{' '}
            <strong>มอบหมายงานใหม่แบบเรียลไทม์</strong> และ{' '}
            <strong>แก้ไขสถานะการเข้าเรียน</strong> ผ่าน Firebase Firestore
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium leading-relaxed text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleGoogleSignIn}
              className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
            >
              {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบด้วย Google'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
