'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'
import {
  CreditCard, Users, BarChart3, Shield, Zap, Globe,
  ArrowRight, LogIn, LayoutDashboard, ChevronRight,
} from 'lucide-react'

const featureKeys = [
  { icon: CreditCard, titleKey: 'featureSubscriptionTitle', descKey: 'featureSubscriptionDesc', color: 'from-blue-500 to-cyan-500' },
  { icon: Users, titleKey: 'featureReferralTitle', descKey: 'featureReferralDesc', color: 'from-violet-500 to-purple-500' },
  { icon: BarChart3, titleKey: 'featureAnalyticsTitle', descKey: 'featureAnalyticsDesc', color: 'from-emerald-500 to-green-500' },
  { icon: Shield, titleKey: 'featureSecurityTitle', descKey: 'featureSecurityDesc', color: 'from-orange-500 to-amber-500' },
  { icon: Zap, titleKey: 'featureAccessTitle', descKey: 'featureAccessDesc', color: 'from-pink-500 to-rose-500' },
  { icon: Globe, titleKey: 'featurePlatformTitle', descKey: 'featurePlatformDesc', color: 'from-indigo-500 to-blue-500' },
] as const

const benefitKeys = [
  'referralBenefit1',
  'referralBenefit2',
  'referralBenefit3',
  'referralBenefit4',
] as const

export default function LandingPage() {
  const { user } = useAuth()
  const t = useTranslations('landing')
  const tc = useTranslations('common')

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950">
      {/* Animated bg */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-violet-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 right-0 w-[300px] h-[300px] bg-purple-600/8 rounded-full blur-[100px]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <span className="text-xl font-bold text-white">{t('brand')}<span className="text-violet-400">{t('brandHighlight')}</span></span>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {user ? (
              <Link href="/dashboard" className="flex items-center gap-2 bg-violet-500 hover:bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                <LayoutDashboard className="w-4 h-4" />
                {t('goToDashboard')}
              </Link>
            ) : (
              <Link href="/login" className="flex items-center gap-2 bg-violet-500 hover:bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                <LogIn className="w-4 h-4" />
                {t('signIn')}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="text-center max-w-3xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-6">
            <Zap className="w-4 h-4 text-violet-400" />
            <span className="text-sm text-violet-300 font-medium">{t('badge')}</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
            {t('heroTitle')}
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
              {t('heroTitleHighlight')}
            </span>
          </h1>

          <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            {t('heroDescription')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href={user ? '/dashboard' : '/login'}
              className="flex items-center gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white font-semibold py-3.5 px-8 rounded-xl transition-all duration-300 shadow-lg shadow-violet-500/25 text-lg"
            >
              {user ? t('goToDashboard') : t('getStarted')}
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#referral"
              className="flex items-center gap-2 text-gray-300 hover:text-white font-medium py-3.5 px-6 transition-colors"
            >
              {t('learnAboutReferrals')}
              <ChevronRight className="w-4 h-4" />
            </a>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl font-bold text-white mb-4">{t('featuresTitle')}</h2>
          <p className="text-gray-400 max-w-xl mx-auto">{t('featuresSubtitle')}</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featureKeys.map((feature, i) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.titleKey}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 hover:bg-white/[0.07] transition-colors"
              >
                <div className={`w-12 h-12 bg-gradient-to-br ${feature.color} rounded-xl flex items-center justify-center mb-4`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{t(feature.titleKey)}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{t(feature.descKey)}</p>
              </motion.div>
            )
          })}
        </div>
      </section>

      {/* Referral Program */}
      <section id="referral" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="bg-gradient-to-br from-violet-900/40 to-purple-900/40 border border-violet-500/20 rounded-3xl p-8 sm:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="inline-flex items-center gap-2 bg-violet-500/20 rounded-full px-3 py-1 mb-4">
                <Users className="w-4 h-4 text-violet-400" />
                <span className="text-sm text-violet-300 font-medium">{t('referralBadge')}</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                {t('referralTitle')}
              </h2>
              <p className="text-gray-300 mb-6 leading-relaxed">
                {t('referralDescription')}
              </p>
              <div className="space-y-3 mb-8">
                {benefitKeys.map((key) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center">
                      <ChevronRight className="w-3 h-3 text-violet-400" />
                    </div>
                    <span className="text-gray-300 text-sm">{t(key)}</span>
                  </div>
                ))}
              </div>
              <Link
                href={user ? '/referrals' : '/login'}
                className="inline-flex items-center gap-2 bg-violet-500 hover:bg-violet-600 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
              >
                {user ? t('viewMyReferrals') : t('startEarning')}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="bg-slate-900/60 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">{t('commissionStructure')}</h3>
                <p className="text-gray-300 leading-relaxed">
                  {t('referralDescription')}
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center"
        >
          <h2 className="text-3xl font-bold text-white mb-4">{t('ctaTitle')}</h2>
          <p className="text-gray-400 mb-8 max-w-md mx-auto">
            {t('ctaDescription')}
          </p>
          <Link
            href={user ? '/dashboard' : '/login'}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white font-semibold py-3.5 px-8 rounded-xl transition-all duration-300 shadow-lg shadow-violet-500/25 text-lg"
          >
            {user ? t('openDashboard') : t('signIn')}
            <ArrowRight className="w-5 h-5" />
          </Link>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <span className="text-sm text-gray-500">{t('footerBrand')}</span>
          <span className="text-sm text-gray-600">{t('footerPowered')}</span>
        </div>
      </footer>
    </div>
  )
}
