import {
  CalendarDays,
  Film,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Settings,
  Sliders,
  UploadCloud,
  X,
  Youtube,
} from 'lucide-react';
import { useState } from 'react';
import type { SidebarTab } from '../types/shortspilot';

interface SidebarProps {
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  userEmail: string | null;
  unreadNotifications: number;
  onLogout: () => Promise<void>;
}

const NAV_ITEMS: { id: SidebarTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'videos', label: 'Video Library', icon: Film },
  { id: 'upload', label: 'Upload Videos', icon: UploadCloud },
  { id: 'queue', label: 'Publishing Queue', icon: ListOrdered },
  { id: 'calendar', label: 'Publishing Calendar', icon: CalendarDays },
  { id: 'automation', label: 'Automation Settings', icon: Sliders },
  { id: 'youtube', label: 'YouTube Channel', icon: Youtube },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  userEmail,
  unreadNotifications,
  onLogout,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navContent = (
    <div className="flex flex-col h-full justify-between p-4 bg-[#000000] border-r border-[#272727]">
      <div className="space-y-6">
        <div className="px-2 pt-1 flex items-center justify-between">
          <span className="title-2 text-white font-semibold tracking-tight">ShortsPilot</span>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
            className="lg:hidden p-1.5 rounded-lg text-[#A3A3A3] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="space-y-1" aria-label="Workspace navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  setMobileOpen(false);
                }}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200 whitespace-nowrap ${
                  active
                    ? 'bg-[#1F1F1F] text-white border border-[#313131]'
                    : 'text-[#A3A3A3] hover:text-white hover:bg-[#181818] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 title-4">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'settings' && unreadNotifications > 0 && (
                  <span className="font-mono-tabular caption-5 text-white bg-[#272727] px-1.5 py-0.5 rounded">
                    {unreadNotifications}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="pt-4 border-t border-[#272727] space-y-2">
        {userEmail && (
          <p className="px-2 caption-5 text-[#737373] truncate" title={userEmail}>
            {userEmail}
          </p>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[#A3A3A3] hover:text-white hover:bg-[#181818] transition-colors duration-200 title-4"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Header Bar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#000000] border-b border-[#272727] sticky top-0 z-30">
        <span className="title-2 text-white font-semibold">ShortsPilot</span>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="p-2 rounded-lg bg-[#181818] border border-[#272727] text-white"
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">{navContent}</aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div className="w-72 max-w-[85vw] h-full">{navContent}</div>
          <div
            className="flex-1 bg-black/70"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        </div>
      )}
    </>
  );
}
