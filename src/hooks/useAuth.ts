import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { DEFAULT_DAILY_TIMES } from '../lib/timezone';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const ensureUserBootstrap = useCallback(async (firebaseUser: User) => {
    if (!firebaseUser.emailVerified) return;

    const userPath = `users/${firebaseUser.uid}`;
    try {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          userId: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || 'Creator',
          photoURL: firebaseUser.photoURL || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, userPath);
    }

    const settingsPath = `publishing_settings/${firebaseUser.uid}`;
    try {
      const settingsRef = doc(db, 'publishing_settings', firebaseUser.uid);
      const settingsSnap = await getDoc(settingsRef);
      if (!settingsSnap.exists()) {
        await setDoc(settingsRef, {
          userId: firebaseUser.uid,
          defaultTitle: 'Wait Until You See This 😱 #shorts',
          defaultDescription: 'Amazing videos every day!',
          defaultHashtags: '#shorts #viral #trending #facts',
          timezone: 'Asia/Kolkata',
          dailyPublishingTimes: DEFAULT_DAILY_TIMES,
          dailyPublishingLimit: 6,
          automationEnabled: true,
          autoRetry: true,
          autoCleanupStorage: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, settingsPath);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser && nextUser.emailVerified) {
        try {
          await ensureUserBootstrap(nextUser);
        } catch (err) {
          console.error('Bootstrap error:', err);
        }
      }
    });
    return () => unsubscribe();
  }, [ensureUserBootstrap]);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    await ensureUserBootstrap(cred.user);
    return cred.user;
  };

  const registerWithEmail = async (email: string, password: string, displayName: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    }
    await sendEmailVerification(cred.user);
    return cred.user;
  };

  const loginWithEmail = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (cred.user.emailVerified) {
      await ensureUserBootstrap(cred.user);
    }
    return cred.user;
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const resendVerification = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const refreshCurrentUser = async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      setUser(auth.currentUser);
      if (auth.currentUser.emailVerified) {
        await ensureUserBootstrap(auth.currentUser);
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  return {
    user,
    authReady,
    signInWithGoogle,
    registerWithEmail,
    loginWithEmail,
    resetPassword,
    resendVerification,
    refreshCurrentUser,
    logout,
  };
}
