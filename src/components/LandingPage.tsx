import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Lock,
  Menu,
  Play,
  RefreshCw,
  UploadCloud,
  X,
} from 'lucide-react';
import { TaglineReveal } from './TaglineReveal';

interface LandingPageProps {
  onOpenAuth: () => void;
}

const SLOTS_PREVIEW = [
  { time: '09:00 AM', file: 'morning_fact_01.mp4', state: 'Scheduled' },
  { time: '12:00 PM', file: 'midday_clip_02.mp4', state: 'Scheduled' },
  { time: '03:00 PM', file: 'afternoon_short_03.mp4', state: 'Scheduled' },
  { time: '06:00 PM', file: 'evening_hook_04.mp4', state: 'Scheduled' },
  { time: '09:00 PM', file: 'prime_story_05.mp4', state: 'Scheduled' },
  { time: '11:00 PM', file: 'late_drop_06.mp4', state: 'Scheduled' },
];

const FAQS = [
  {
    q: 'Does ShortsPilot keep publishing when I close my laptop?',
    a: 'Yes. All uploaded videos are stored in private Backblaze B2 storage and all scheduled jobs live in Firestore. A minute by minute cloud cron relay triggers the Render scheduler automatically independently of your browser.',
  },
  {
    q: 'How does the rolling six Shorts queue work?',
    a: 'ShortsPilot targets six upcoming scheduled Shorts on your connected YouTube channel. Whenever one scheduled Short is confirmed published on YouTube, the scheduler promotes the next waiting video into the next open daily slot.',
  },
  {
    q: 'Can every video share one title, description, and hashtag template?',
    a: 'Yes. Configure your default title, description, and hashtags once. Every newly uploaded video inherits that template automatically, while still allowing per video overrides whenever you need them.',
  },
  {
    q: 'Are my YouTube OAuth tokens stored safely?',
    a: 'Your Google OAuth refresh and access tokens are encrypted on the server using AES 256 GCM and stored in a server only Firestore collection that browser clients cannot read.',
  },
  {
    q: 'Why might YouTube keep uploaded Shorts private at first?',
    a: 'Google restricts uploads from unverified OAuth projects to private visibility until the required YouTube Data API compliance audit is completed. ShortsPilot warns you clearly and never marks a private video as published.',
  },
  {
    q: 'Will ShortsPilot ever delete a video from my YouTube channel?',
    a: 'No. Removing a waiting item only deletes the local queue entry. Your YouTube videos and permanent publishing history remain untouched.',
  },
];

export function LandingPage({ onOpenAuth }: LandingPageProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setLegalDoc(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-screen bg-[#000000] text-[#F5F5F5]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-white focus:text-black button-sm"
      >
        Skip to content
      </a>

      {/* Floating Compact Top Bar (3 zones) */}
      <div className="fixed top-4 inset-x-0 z-40 px-4 flex justify-center pointer-events-none">
        <header className="pointer-events-auto flex items-center justify-between gap-8 px-4 py-2.5 rounded-xl bg-[#181818]/85 backdrop-blur-md border border-[#272727] max-w-4xl w-full">
          <a
            href="#top"
            className="title-3 text-white font-semibold tracking-tight whitespace-nowrap shrink-0"
          >
            ShortsPilot
          </a>

          <nav className="hidden md:flex items-center gap-6 caption-1 text-[#A3A3A3]">
            <a
              href="#workflow"
              className="hover:text-white transition-colors duration-200 whitespace-nowrap shrink-0"
            >
              Workflow
            </a>
            <a
              href="#scheduler"
              className="hover:text-white transition-colors duration-200 whitespace-nowrap shrink-0"
            >
              Scheduler
            </a>
            <a
              href="#security"
              className="hover:text-white transition-colors duration-200 whitespace-nowrap shrink-0"
            >
              Security
            </a>
            <a
              href="#faq"
              className="hover:text-white transition-colors duration-200 whitespace-nowrap shrink-0"
            >
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenAuth}
              className="px-3 py-2 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white active:scale-[0.98] transition-all duration-200 whitespace-nowrap shrink-0"
            >
              Open workspace
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="md:hidden p-2 rounded-lg text-[#D4D4D4] hover:text-white hover:bg-[#272727] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </header>
      </div>

      {/* Mobile Full-Height Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 bg-[#000000]/95 backdrop-blur-xl pt-24 px-6 pb-8 flex flex-col justify-between md:hidden">
          <nav className="flex flex-col gap-6">
            {[
              { label: 'Workflow', href: '#workflow' },
              { label: 'Scheduler', href: '#scheduler' },
              { label: 'Security', href: '#security' },
              { label: 'FAQ', href: '#faq' },
            ].map((item, idx) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="heading-4 text-white transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ transitionDelay: `${idx * 60}ms` }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenAuth();
            }}
            className="w-full py-3 px-4 rounded-xl bg-[#F5F5F5] text-[#000000] button-md"
          >
            Start automating Shorts
          </button>
        </div>
      )}

      <main id="main-content">
        {/* Hero Section */}
        <section id="top" className="pt-36 pb-20 px-6">
          <div className="max-w-5xl mx-auto space-y-12">
            <div className="max-w-[680px] space-y-6">
              <h1 className="heading-2 sm:heading-1 hero-text-gradient">
                Six daily YouTube Shorts,
                <br />
                scheduled automatically
              </h1>
              <p className="body-3 text-[#A3A3A3] max-w-[680px]">
                Upload dozens of vertical clips in one batch, apply a single shared title and
                hashtag template, and let ShortsPilot keep six upcoming slots scheduled on your
                channel around the clock.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#F5F5F5] text-[#000000] button-md hover:bg-white active:scale-[0.98] transition-all duration-200 whitespace-nowrap shrink-0"
                >
                  <span>Start automating Shorts</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 caption-2 text-[#737373] pt-2">
                <span>Official YouTube Data API v3</span>
                <span aria-hidden="true">·</span>
                <span>Encrypted OAuth tokens</span>
                <span aria-hidden="true">·</span>
                <span>India Standard Time slots</span>
              </div>
            </div>

            {/* Product Mechanism Preview */}
            <div
              id="scheduler"
              className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#272727]">
                <div className="space-y-1">
                  <h2 className="title-2 text-white">Upcoming six slots · Asia/Kolkata</h2>
                  <p className="caption-2 text-[#A3A3A3]">
                    When a scheduled Short publishes on YouTube, the next waiting clip fills the
                    next open slot automatically.
                  </p>
                </div>
                <span className="caption-3 font-mono-tabular text-[#D4D4D4] border border-[#313131] bg-[#1F1F1F] px-2.5 py-1 rounded-md">
                  6 / 6 queued
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {SLOTS_PREVIEW.map((slot, index) => (
                  <div
                    key={slot.time}
                    className="bg-[#1F1F1F] border border-[#272727] rounded-xl p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="caption-3 font-mono-tabular text-white">
                        Slot {index + 1} · {slot.time}
                      </span>
                      <span className="caption-5 text-emerald-400">{slot.state}</span>
                    </div>
                    <p className="body-5 text-[#D4D4D4] truncate">{slot.file}</p>
                    <p className="caption-5 text-[#737373]">
                      Shared template · Wait Until You See This 😱 #shorts
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="workflow" className="py-20 px-6 border-t border-[#1F1F1F]">
          <div className="max-w-5xl mx-auto space-y-12">
            <div className="max-w-[680px] space-y-3">
              <h2 className="heading-4 text-white">Three steps from upload to daily schedule</h2>
              <p className="body-3 text-[#A3A3A3]">
                Built for creators who upload batches of 50 or more vertical videos and want
                predictable daily publishing without leaving a browser open.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <article className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-3">
                <UploadCloud className="w-5 h-5 text-[#D4D4D4]" />
                <h3 className="title-2 text-white">01. Bulk upload clips</h3>
                <p className="body-6 text-[#A3A3A3]">
                  Drop dozens of MP4 files directly into private Backblaze B2 storage with
                  individual resumable progress bars and duration checks.
                </p>
              </article>

              <article className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-3">
                <CalendarClock className="w-5 h-5 text-[#D4D4D4]" />
                <h3 className="title-2 text-white">02. Set one metadata template</h3>
                <p className="body-6 text-[#A3A3A3]">
                  Define a shared title, description, and hashtag block once, with six daily
                  publishing times defaulting to Asia/Kolkata.
                </p>
              </article>

              <article className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-3">
                <RefreshCw className="w-5 h-5 text-[#D4D4D4]" />
                <h3 className="title-2 text-white">03. Rolling queue maintenance</h3>
                <p className="body-6 text-[#A3A3A3]">
                  Close your browser and shut down your laptop. A lightweight cloud cron relay checks
                  published videos every minute and schedules open slots.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* Security & Architecture Bento */}
        <section id="security" className="py-20 px-6 border-t border-[#1F1F1F]">
          <div className="max-w-5xl mx-auto space-y-12">
            <div className="max-w-[680px] space-y-3">
              <h2 className="heading-4 text-white">Production safeguards built into every upload</h2>
              <p className="body-3 text-[#A3A3A3]">
                Atomic Firestore locks and idempotency keys prevent duplicate YouTube uploads even
                when multiple scheduler triggers run concurrently.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-3">
                <Lock className="w-5 h-5 text-[#D4D4D4]" />
                <h3 className="title-2 text-white">Encrypted OAuth refresh tokens</h3>
                <p className="body-6 text-[#A3A3A3]">
                  OAuth access and refresh tokens are encrypted with AES 256 GCM on the backend and
                  never stored in browser storage or readable by client queries. Expired tokens
                  refresh automatically without forcing frequent reconnects.
                </p>
              </div>

              <div className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-3">
                <Play className="w-5 h-5 text-[#D4D4D4]" />
                <h3 className="title-2 text-white">Verified publication checks</h3>
                <p className="body-6 text-[#A3A3A3]">
                  Videos stay in Scheduled status until YouTube confirms live publication, keeping
                  source files safe on any upload error.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Mandatory Tagline Reveal Section */}
        <TaglineReveal text="Upload fifty different Shorts once and keep six scheduled slots filled around the clock." />

        {/* FAQ Section */}
        <section id="faq" className="py-20 px-6 border-t border-[#1F1F1F]">
          <div className="max-w-3xl mx-auto space-y-8">
            <h2 className="heading-4 text-white">Frequently asked questions</h2>
            <div className="divide-y divide-[#272727] border-y border-[#272727]">
              {FAQS.map((item, idx) => {
                const isOpen = openFaq === idx;
                return (
                  <div key={item.q} className="py-4">
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : idx)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center justify-between gap-4 text-left py-1 text-white title-3 hover:text-[#D4D4D4] transition-colors"
                    >
                      <span>{item.q}</span>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 text-[#A3A3A3] transition-transform duration-300 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isOpen && <p className="pt-3 body-6 text-[#A3A3A3]">{item.a}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-24 px-6 border-t border-[#1F1F1F]">
          <div className="max-w-[680px] mx-auto text-center space-y-6">
            <h2 className="heading-3 text-white">Ready to automate your daily Shorts queue</h2>
            <p className="body-3 text-[#A3A3A3]">
              Sign in, connect your YouTube channel, and upload your first batch of Shorts. Pause or
              disconnect your channel at any time.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={onOpenAuth}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#F5F5F5] text-[#000000] button-md hover:bg-white active:scale-[0.98] transition-all duration-200"
              >
                <span>Open ShortsPilot workspace</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-[#1F1F1F] py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 caption-2 text-[#737373]">
          <span>ShortsPilot · Automated YouTube Shorts Scheduler</span>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setLegalDoc('privacy')}
              className="hover:text-white transition-colors"
            >
              Privacy policy
            </button>
            <button
              type="button"
              onClick={() => setLegalDoc('terms')}
              className="hover:text-white transition-colors"
            >
              Terms of service
            </button>
          </div>
        </div>
      </footer>

      {legalDoc && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="heading-6 text-white">
                {legalDoc === 'privacy' ? 'Privacy policy' : 'Terms of service'}
              </h3>
              <button
                type="button"
                onClick={() => setLegalDoc(null)}
                aria-label="Close legal notice"
                className="p-2 rounded-lg text-[#A3A3A3] hover:text-white hover:bg-[#272727]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="body-6 text-[#A3A3A3]">
              {legalDoc === 'privacy'
                ? 'ShortsPilot isolates every user account inside Firebase Authentication and Firestore security rules. Google OAuth refresh tokens are encrypted server side using AES 256 GCM and used solely to upload and verify scheduled videos on the YouTube channel you explicitly connect.'
                : 'You are responsible for ensuring uploaded videos comply with YouTube Community Guidelines and Shorts eligibility criteria. ShortsPilot never modifies already published videos or deletes content from your YouTube channel.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
