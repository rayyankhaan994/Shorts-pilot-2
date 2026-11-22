import { useCallback, useEffect, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { AutomationSettingsView } from './components/AutomationSettingsView';
import { DashboardView } from './components/DashboardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';
import { PublishingCalendarView } from './components/PublishingCalendarView';
import { PublishingQueueView } from './components/PublishingQueueView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { UploadVideosView } from './components/UploadVideosView';
import { VideoLibraryView } from './components/VideoLibraryView';
import { YouTubeChannelView } from './components/YouTubeChannelView';
import { useAuth } from './hooks/useAuth';
import { useShortsPilotData } from './hooks/useShortsPilotData';
import type { RefillResult, SidebarTab } from './types/shortspilot';

function ShortsPilotApp() {
  const {
    user,
    authReady,
    signInWithGoogle,
    registerWithEmail,
    loginWithEmail,
    resetPassword,
    resendVerification,
    refreshCurrentUser,
    logout,
  } = useAuth();

  const data = useShortsPilotData(user, authReady);

  const [activeTab, setActiveTab] = useState<SidebarTab>('dashboard');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [refilling, setRefilling] = useState(false);
  const [refillResult, setRefillResult] = useState<RefillResult | null>(null);
  const [refillError, setRefillError] = useState('');

  const handleManualRefill = useCallback(async () => {
    setRefilling(true);
    setRefillError('');
    try {
      const res = await data.triggerManualRefill(true);
      setRefillResult(res);
    } catch (err) {
      setRefillError(err instanceof Error ? err.message : 'Failed to refill queue');
    } finally {
      setRefilling(false);
    }
  }, [data]);

  // Listen for OAuth popup completion messages
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        !origin.endsWith('.run.app') &&
        !origin.endsWith('.onrender.com') &&
        !origin.includes('localhost') &&
        !origin.includes('127.0.0.1')
      ) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        void data.fetchReadiness();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR' && event.data?.error) {
        setRefillError(String(event.data.error));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [data]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#000000] flex items-center justify-center p-6">
        <div className="w-64 space-y-3">
          <div className="h-5 w-32 bg-[#181818] rounded animate-pulse mx-auto" />
          <div className="h-2 w-full bg-[#181818] rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!user || !user.emailVerified) {
    return (
      <>
        <LandingPage onOpenAuth={() => setAuthModalOpen(true)} />
        <AuthModal
          open={authModalOpen || Boolean(user && !user.emailVerified)}
          onClose={() => setAuthModalOpen(false)}
          user={user}
          onGoogleSignIn={signInWithGoogle}
          onEmailLogin={loginWithEmail}
          onEmailRegister={registerWithEmail}
          onResetPassword={resetPassword}
          onResendVerification={resendVerification}
          onRefreshUser={refreshCurrentUser}
          onLogout={logout}
        />
      </>
    );
  }

  const unreadCount = data.notifications.filter((n) => !n.read).length;
  const timezone = data.settings?.timezone || 'Asia/Kolkata';

  return (
    <div className="min-h-screen bg-[#000000] text-[#F5F5F5] flex flex-col lg:flex-row">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        userEmail={user.email}
        unreadNotifications={unreadCount}
        onLogout={logout}
      />

      <main className="flex-1 min-w-0 p-6 lg:p-10 max-w-7xl mx-auto w-full">
        {activeTab === 'dashboard' && (
          <DashboardView
            videos={data.videos}
            settings={data.settings}
            channel={data.channel}
            history={data.history}
            notifications={data.notifications}
            loading={data.loading}
            refilling={refilling}
            refillResult={refillResult}
            refillError={refillError}
            onRefillQueue={handleManualRefill}
            onNavigate={setActiveTab}
            onToggleAutomation={data.toggleAutomation}
          />
        )}

        {activeTab === 'videos' && (
          <VideoLibraryView
            videos={data.videos}
            settings={data.settings}
            onGetPlaybackUrl={data.getVideoPlaybackUrl}
            onUpdateMetadata={data.updateVideoMetadata}
            onDeleteVideo={data.deleteWaitingVideo}
          />
        )}

        {activeTab === 'upload' && (
          <UploadVideosView
            settings={data.settings}
            existingVideos={data.videos}
            getIdToken={data.getIdToken}
            onCreateVideoRecord={data.createVideoRecord}
          />
        )}

        {activeTab === 'queue' && (
          <PublishingQueueView
            videos={data.videos}
            settings={data.settings}
            refilling={refilling}
            onRefillQueue={handleManualRefill}
            onToggleAutomation={data.toggleAutomation}
            onReorderWaiting={data.reorderWaitingVideos}
            onRetryFailed={data.retryFailedVideo}
            onDeleteWaiting={data.deleteWaitingVideo}
          />
        )}

        {activeTab === 'calendar' && (
          <PublishingCalendarView
            videos={data.videos}
            history={data.history}
            settings={data.settings}
          />
        )}

        {activeTab === 'automation' && (
          <AutomationSettingsView
            settings={data.settings}
            videos={data.videos}
            onSaveSettings={data.savePublishingSettings}
          />
        )}

        {activeTab === 'youtube' && (
          <YouTubeChannelView
            channel={data.channel}
            readiness={data.readiness}
            timezone={timezone}
            onConnect={data.connectYouTubeChannel}
            onDisconnect={data.disconnectYouTubeChannel}
            onRefresh={data.refreshYouTubeChannel}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            user={user}
            readiness={data.readiness}
            notifications={data.notifications}
            timezone={timezone}
            onResetPassword={resetPassword}
            onMarkNotificationRead={data.markNotificationRead}
          />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ShortsPilotApp />
    </ErrorBoundary>
  );
}
