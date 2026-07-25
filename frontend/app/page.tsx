'use client'

import { motion, useInView } from 'framer-motion'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'
import { useRef } from 'react'
import {
  CreditCard, Users, Globe,
  ArrowRight, LogIn, LayoutDashboard,
  Code2, Webhook, KeyRound, Lock, CheckCircle2,
  GitBranch, BookOpen, Headphones, TrendingUp,
  DollarSign, Layers, Repeat, Activity,
  ChevronRight, Sparkles, ArrowUpRight,
  Bot, Mail, Gauge, Search,
} from 'lucide-react'

/* ── Fade-in wrapper ── */
function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/* ── Animated bar ── */
function Bar({ width, delay, color }: { width: string; delay: number; color: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true })
  return (
    <div ref={ref} className="h-2 bg-white/5 rounded-full overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={inView ? { width } : {}}
        transition={{ duration: 0.8, delay, ease: 'easeOut' }}
      />
    </div>
  )
}

/* ── Feature cards data ── */
const features = [
  { icon: Layers, titleKey: 'featureRailsTitle', descKey: 'featureRailsDesc', gradient: 'from-blue-500 to-cyan-500' },
  { icon: CreditCard, titleKey: 'featureCreditsTitle', descKey: 'featureCreditsDesc', gradient: 'from-emerald-500 to-green-500' },
  { icon: Users, titleKey: 'featureReferralTitle', descKey: 'featureReferralDesc', gradient: 'from-violet-500 to-purple-500' },
  { icon: Bot, titleKey: 'featureAssistantTitle', descKey: 'featureAssistantDesc', gradient: 'from-violet-500 to-fuchsia-500' },
  { icon: Sparkles, titleKey: 'featureRetentionTitle', descKey: 'featureRetentionDesc', gradient: 'from-pink-500 to-rose-500' },
  { icon: Globe, titleKey: 'featurePlatformTitle', descKey: 'featurePlatformDesc', gradient: 'from-indigo-500 to-blue-500' },
] as const

/* ── AI capability cards data ── */
const aiFeatures = [
  { icon: Bot, titleKey: 'aiCard1Title', descKey: 'aiCard1Desc' },
  { icon: Mail, titleKey: 'aiCard2Title', descKey: 'aiCard2Desc' },
  { icon: Gauge, titleKey: 'aiCard3Title', descKey: 'aiCard3Desc' },
  { icon: Search, titleKey: 'aiCard4Title', descKey: 'aiCard4Desc' },
] as const

/* ── How it works steps ── */
const steps = [
  { icon: Layers, color: 'from-violet-500 to-purple-600' },
  { icon: Activity, color: 'from-blue-500 to-cyan-500' },
  { icon: TrendingUp, color: 'from-emerald-500 to-green-500' },
]

/* ── Developer features ── */
const devFeatures = [
  { icon: Code2, titleKey: 'devApi', descKey: 'devApiDesc' },
  { icon: Webhook, titleKey: 'devWebhooks', descKey: 'devWebhooksDesc' },
  { icon: Lock, titleKey: 'devAuth', descKey: 'devAuthDesc' },
  { icon: KeyRound, titleKey: 'devKeys', descKey: 'devKeysDesc' },
] as const

/* ── Referral benefits ── */
const benefitKeys = [
  'referralBenefit1',
  'referralBenefit2',
  'referralBenefit3',
  'referralBenefit4',
] as const

/* ── Example referral levels (illustrative) ── */
const exampleLevels = [
  { level: 1, rate: 15 },
  { level: 2, rate: 5 },
  { level: 3, rate: 3 },
]

export default function LandingPage() {
  const { user } = useAuth()
  const t = useTranslations('landing')

  return (
    <div className="min-h-screen bg-[#030712] text-white">
      {/* ── Background ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/3 w-[700px] h-[700px] bg-violet-600/8 rounded-full blur-[150px]" />
        <div className="absolute top-1/2 -right-20 w-[500px] h-[500px] bg-blue-600/6 rounded-full blur-[130px]" />
        <div className="absolute -bottom-40 left-0 w-[600px] h-[600px] bg-purple-600/5 rounded-full blur-[140px]" />
        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      {/* ═══════════ NAV ═══════════ */}
      <nav className="relative z-20 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <span className="text-white font-bold text-xs">IN</span>
            </div>
            <span className="text-lg font-bold">
              {t('brand')}<span className="text-violet-400">{t('brandHighlight')}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {user ? (
              <Link href="/dashboard" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-violet-500/20">
                <LayoutDashboard className="w-4 h-4" />
                {t('goToDashboard')}
              </Link>
            ) : (
              <Link href="/login" className="flex items-center gap-2 bg-white/10 hover:bg-white/15 border border-white/10 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors backdrop-blur-sm">
                <LogIn className="w-4 h-4" />
                {t('signIn')}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* ═══════════ HERO ═══════════ */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 sm:pt-32 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="text-center max-w-4xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-8">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-sm text-violet-300/90">{t('badge')}</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight mb-6">
            {t('heroTitle')}
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
              {t('heroTitleHighlight')}
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            {t('heroDescription')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
            <Link
              href={user ? '/dashboard' : '/login'}
              className="group flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-semibold py-3.5 px-8 rounded-2xl transition-all duration-300 shadow-xl shadow-violet-600/20 hover:shadow-violet-600/30 text-lg"
            >
              {user ? t('goToDashboard') : t('getStarted')}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="#features"
              className="flex items-center gap-2 text-slate-400 hover:text-white font-medium py-3.5 px-6 transition-colors"
            >
              {t('learnAboutReferrals')}
              <ChevronRight className="w-4 h-4" />
            </a>
          </div>

          {/* ── Hero metrics ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/5 rounded-2xl overflow-hidden border border-white/5">
            {(['stat1', 'stat2', 'stat3'] as const).map((key, i) => (
              <motion.div
                key={key}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 + i * 0.15 }}
                className="bg-[#030712] px-6 py-6 text-center"
              >
                <p className="text-3xl sm:text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent mb-1">
                  {t(`${key}Value`)}
                </p>
                <p className="text-sm text-slate-500">{t(`${key}Label`)}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ═══════════ HOW IT WORKS ═══════════ */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <FadeIn className="text-center mb-16">
          <p className="text-sm font-medium text-violet-400 uppercase tracking-wider mb-3">{t('howItWorksBadge')}</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('howItWorksTitle')}</h2>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
          {([1, 2, 3] as const).map((step, i) => {
            const StepIcon = steps[i].icon
            return (
              <FadeIn key={step} delay={i * 0.12}>
                <div className="relative text-center">
                  <div className={`w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br ${steps[i].color} flex items-center justify-center shadow-lg`}>
                    <StepIcon className="w-7 h-7 text-white" />
                  </div>
                  {i < 2 && (
                    <div className="hidden md:block absolute top-8 left-[calc(50%+48px)] w-[calc(100%-96px)] border-t border-dashed border-white/10" />
                  )}
                  <div className="text-xs font-bold text-violet-400/60 uppercase tracking-widest mb-2">
                    {t('stepLabel', { step })}
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{t(`step${step}Title`)}</h3>
                  <p className="text-slate-400 leading-relaxed text-sm">{t(`step${step}Desc`)}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      </section>

      {/* ═══════════ FEATURES ═══════════ */}
      <section id="features" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <FadeIn className="text-center mb-16">
          <p className="text-sm font-medium text-emerald-400 uppercase tracking-wider mb-3">{t('featuresBadge')}</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t('featuresTitle')}</h2>
          <p className="text-slate-400 max-w-xl mx-auto">{t('featuresSubtitle')}</p>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((feature, i) => {
            const Icon = feature.icon
            return (
              <FadeIn key={feature.titleKey} delay={i * 0.08}>
                <div className="group relative bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 hover:bg-white/[0.06] hover:border-white/10 transition-all duration-300 h-full">
                  <div className={`w-11 h-11 bg-gradient-to-br ${feature.gradient} rounded-xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-base font-semibold mb-2">{t(feature.titleKey)}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{t(feature.descKey)}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      </section>

      {/* ═══════════ AI-FIRST ═══════════ */}
      <section id="ai" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <FadeIn className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs text-violet-300 font-medium">{t('aiBadge')}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t('aiTitle')}</h2>
          <p className="text-slate-400 max-w-xl mx-auto">{t('aiSubtitle')}</p>
        </FadeIn>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {aiFeatures.map((feat, i) => {
            const Icon = feat.icon
            return (
              <FadeIn key={feat.titleKey} delay={i * 0.08}>
                <div className="group bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 hover:bg-white/[0.06] hover:border-white/10 transition-all duration-300 h-full">
                  <div className="w-10 h-10 bg-violet-500/10 border border-violet-500/15 rounded-xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <Icon className="w-5 h-5 text-violet-400" />
                  </div>
                  <h3 className="text-base font-semibold mb-2">{t(feat.titleKey)}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{t(feat.descKey)}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      </section>

      {/* ═══════════ REFERRAL PROGRAM ═══════════ */}
      <section id="referral" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="relative overflow-hidden bg-gradient-to-br from-violet-950/60 via-purple-950/40 to-slate-950/60 border border-violet-500/10 rounded-3xl">
          {/* Glow */}
          <div className="absolute -top-32 -right-32 w-64 h-64 bg-violet-500/10 rounded-full blur-[100px]" />
          <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-purple-500/10 rounded-full blur-[100px]" />

          <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-12 p-8 sm:p-12">
            {/* Left */}
            <FadeIn>
              <div className="inline-flex items-center gap-2 bg-violet-500/15 border border-violet-500/20 rounded-full px-3 py-1 mb-5">
                <Users className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-xs text-violet-300 font-medium">{t('referralBadge')}</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                {t('referralTitle')}
              </h2>
              <p className="text-slate-300/80 mb-8 leading-relaxed">
                {t('referralDescription')}
              </p>
              <div className="space-y-3 mb-8">
                {benefitKeys.map((key) => (
                  <div key={key} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle2 className="w-3 h-3 text-violet-400" />
                    </div>
                    <span className="text-slate-300/80 text-sm leading-relaxed">{t(key)}</span>
                  </div>
                ))}
              </div>
              <Link
                href={user ? '/referrals' : '/login'}
                className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 px-6 rounded-xl transition-colors shadow-lg shadow-violet-600/20"
              >
                {user ? t('viewMyReferrals') : t('startEarning')}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </FadeIn>

            {/* Right — Infographic */}
            <FadeIn delay={0.15} className="space-y-5">
              {/* Commission example */}
              <div className="bg-slate-900/60 border border-white/[0.06] rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">{t('exampleTitle')}</h3>
                </div>
                <p className="text-xs text-slate-500 mb-5">
                  {t('exampleBase')}: <span className="text-white font-medium">$100</span>{t('examplePerMonth')}
                </p>

                <div className="space-y-4">
                  {exampleLevels.map((lvl, i) => (
                    <div key={lvl.level}>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-violet-500/15 text-violet-300 text-xs font-bold flex items-center justify-center">
                            {lvl.level}
                          </span>
                          <span className="text-slate-400">{t('exampleLevel', { level: lvl.level })}</span>
                        </div>
                        <span className="text-white font-medium">{lvl.rate}% &mdash; ${lvl.rate.toFixed(2)}</span>
                      </div>
                      <Bar
                        width={`${(lvl.rate / 15) * 100}%`}
                        delay={i * 0.15}
                        color={i === 0 ? 'bg-gradient-to-r from-violet-500 to-purple-500' : 'bg-gradient-to-r from-violet-600/60 to-purple-600/60'}
                      />
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
                    <Repeat className="w-3.5 h-3.5" />
                    <span>{t('exampleMore')}</span>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-between">
                  <span className="text-sm text-slate-400">{t('exampleTotal')}</span>
                  <span className="text-lg font-bold bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                    {t('exampleTotalConfigurable')}
                  </span>
                </div>

                <p className="text-[11px] text-slate-600 mt-3 leading-relaxed">{t('exampleNote')}</p>
              </div>

              {/* Network effect */}
              <div className="bg-slate-900/60 border border-white/[0.06] rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">{t('scenarioTitle')}</h3>
                </div>

                {/* Visual network tree */}
                <div className="flex justify-center py-4">
                  <div className="flex flex-col items-center gap-2">
                    {/* You */}
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-xs font-bold shadow-lg shadow-violet-500/30">
                      {t('you')}
                    </div>
                    <div className="w-px h-3 bg-violet-500/30" />
                    {/* Level 1 */}
                    <div className="flex gap-3">
                      {[1, 2, 3].map((n) => (
                        <div key={n} className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-[10px] text-violet-300" />
                          <div className="w-px h-2 bg-violet-500/20" />
                          <div className="flex gap-1.5">
                            {[1, 2].map((m) => (
                              <div key={m} className="w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20" />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">...{t('andDeeper')}</p>
                  </div>
                </div>

                <p className="text-sm text-slate-400 leading-relaxed mb-4 text-center">
                  {t('scenarioDesc')}
                </p>
                <div className="bg-violet-500/10 border border-violet-500/15 rounded-xl p-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('scenarioIncome')}</p>
                  <p className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                    {t('scenarioAmount')}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-0.5">{t('scenarioNote')}</p>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══════════ FOR DEVELOPERS ═══════════ */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <FadeIn className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-4">
            <Code2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs text-emerald-300 font-medium">{t('devBadge')}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t('devTitle')}</h2>
          <p className="text-slate-400 max-w-xl mx-auto">{t('devSubtitle')}</p>
        </FadeIn>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {devFeatures.map((feat, i) => {
            const Icon = feat.icon
            return (
              <FadeIn key={feat.titleKey} delay={i * 0.08}>
                <div className="group bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 hover:bg-white/[0.06] hover:border-white/10 transition-all duration-300">
                  <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/15 rounded-xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <Icon className="w-5 h-5 text-emerald-400" />
                  </div>
                  <h3 className="text-base font-semibold mb-2">{t(feat.titleKey)}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{t(feat.descKey)}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      </section>

      {/* ═══════════ PRICING ═══════════ */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <FadeIn className="text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t('pricingTitle')}</h2>
          <p className="text-slate-400 max-w-xl mx-auto mb-12">{t('pricingSubtitle')}</p>

          <div className="max-w-md mx-auto bg-white/[0.03] border border-white/[0.06] rounded-3xl p-10 hover:border-white/10 transition-colors">
            <div className="w-16 h-16 mx-auto mb-6 bg-gradient-to-br from-violet-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-xl shadow-violet-600/20">
              <DollarSign className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-3xl font-bold mb-2">{t('pricingFree')}</h3>
            <p className="text-slate-400 mb-6 leading-relaxed text-sm">{t('pricingFreeDesc')}</p>
            <div className="border-t border-white/5 pt-4">
              <p className="text-xs text-slate-600">{t('pricingNote')}</p>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <FadeIn>
          <div className="relative overflow-hidden text-center bg-gradient-to-br from-violet-950/60 to-purple-950/60 border border-violet-500/10 rounded-3xl p-12 sm:p-16">
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-violet-500/10 rounded-full blur-[80px]" />
            <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-purple-500/10 rounded-full blur-[80px]" />

            <div className="relative">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t('ctaTitle')}</h2>
              <p className="text-slate-300/70 mb-10 max-w-lg mx-auto leading-relaxed">
                {t('ctaDescription')}
              </p>
              <Link
                href={user ? '/dashboard' : '/login'}
                className="group inline-flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-semibold py-4 px-10 rounded-2xl transition-all duration-300 shadow-xl shadow-violet-600/20 hover:shadow-violet-600/30 text-lg"
              >
                {user ? t('openDashboard') : t('getStarted')}
                <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="relative z-10 border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-[8px]">IN</span>
            </div>
            <span className="text-sm text-slate-600">{t('footerBrand')}</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/inite-ai/inite-billing-service/blob/main/docs/api.md" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-300 transition-colors">
              <BookOpen className="w-3.5 h-3.5" />
              {t('footerApiDocs')}
            </a>
            <a href="https://github.com/inite-ai/inite-billing-service" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-300 transition-colors">
              <GitBranch className="w-3.5 h-3.5" />
              {t('footerGithub')}
            </a>
            <a href="mailto:support@inite.ai" className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-300 transition-colors">
              <Headphones className="w-3.5 h-3.5" />
              {t('footerSupport')}
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
