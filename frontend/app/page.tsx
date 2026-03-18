'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import {
  CreditCard, Users, BarChart3, Shield, Zap, Globe,
  ArrowRight, LogIn, LayoutDashboard, ChevronRight,
} from 'lucide-react'

const features = [
  {
    icon: CreditCard,
    title: 'Subscription Management',
    description: 'Manage all your subscriptions in one place. View billing cycles, cancel or renew anytime.',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    icon: Users,
    title: '7-Level Referral Program',
    description: 'Earn up to 30% commission through our multi-level referral system. Build your network and grow.',
    color: 'from-violet-500 to-purple-500',
  },
  {
    icon: BarChart3,
    title: 'Detailed Analytics',
    description: 'Track your earnings, referrals, and commissions with real-time statistics and breakdowns by level.',
    color: 'from-emerald-500 to-green-500',
  },
  {
    icon: Shield,
    title: 'Secure Payments',
    description: 'Enterprise-grade security with multiple payment rails. Your data is always protected.',
    color: 'from-orange-500 to-amber-500',
  },
  {
    icon: Zap,
    title: 'Instant Access',
    description: 'Get immediate access to products and services after payment. No waiting, no delays.',
    color: 'from-pink-500 to-rose-500',
  },
  {
    icon: Globe,
    title: 'Multi-Service Platform',
    description: 'One billing account for all INITE services. Unified dashboard, single referral link.',
    color: 'from-indigo-500 to-blue-500',
  },
]

const referralLevels = [
  { level: 1, rate: '15%' },
  { level: 2, rate: '1%' },
  { level: 3, rate: '1.5%' },
  { level: 4, rate: '2%' },
  { level: 5, rate: '3%' },
  { level: 6, rate: '3.5%' },
  { level: 7, rate: '4%' },
]

export default function LandingPage() {
  const { user } = useAuth()

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
          <span className="text-xl font-bold text-white">INITE<span className="text-violet-400"> Billing</span></span>
          <div className="flex items-center gap-3">
            {user ? (
              <Link href="/dashboard" className="flex items-center gap-2 bg-violet-500 hover:bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </Link>
            ) : (
              <Link href="/login" className="flex items-center gap-2 bg-violet-500 hover:bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                <LogIn className="w-4 h-4" />
                Sign In
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
            <span className="text-sm text-violet-300 font-medium">Multi-service billing platform</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
            One platform for{' '}
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
              subscriptions & referrals
            </span>
          </h1>

          <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Manage subscriptions across all INITE services. Earn commissions with a 7-level referral program.
            Track everything in real-time with a unified dashboard.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href={user ? '/dashboard' : '/login'}
              className="flex items-center gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white font-semibold py-3.5 px-8 rounded-xl transition-all duration-300 shadow-lg shadow-violet-500/25 text-lg"
            >
              {user ? 'Go to Dashboard' : 'Get Started'}
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#referral"
              className="flex items-center gap-2 text-gray-300 hover:text-white font-medium py-3.5 px-6 transition-colors"
            >
              Learn about referrals
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
          <h2 className="text-3xl font-bold text-white mb-4">Everything you need</h2>
          <p className="text-gray-400 max-w-xl mx-auto">A complete billing solution with built-in referral system</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 hover:bg-white/[0.07] transition-colors"
              >
                <div className={`w-12 h-12 bg-gradient-to-br ${feature.color} rounded-xl flex items-center justify-center mb-4`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
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
                <span className="text-sm text-violet-300 font-medium">Referral Program</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                Earn up to <span className="text-violet-400">30%</span> commission
              </h2>
              <p className="text-gray-300 mb-6 leading-relaxed">
                Our 7-level referral system rewards you for every sale in your network.
                Share your unique link and earn commissions not just from direct referrals,
                but from the entire depth of your network.
              </p>
              <div className="space-y-3 mb-8">
                {['Instant commission tracking', 'Monthly payouts (NET-15)', 'Per-service referral configuration', 'Real-time tree visualization'].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center">
                      <ChevronRight className="w-3 h-3 text-violet-400" />
                    </div>
                    <span className="text-gray-300 text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Link
                href={user ? '/referrals' : '/login'}
                className="inline-flex items-center gap-2 bg-violet-500 hover:bg-violet-600 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
              >
                {user ? 'View My Referrals' : 'Start Earning'}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="bg-slate-900/60 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Commission Structure</h3>
                <div className="space-y-3">
                  {referralLevels.map((lvl) => (
                    <div key={lvl.level} className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-sm font-bold text-violet-300">
                        {lvl.level}
                      </span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${parseFloat(lvl.rate) / 15 * 100}%` }}
                          viewport={{ once: true }}
                          transition={{ delay: lvl.level * 0.1, duration: 0.5 }}
                          className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full"
                        />
                      </div>
                      <span className="text-white font-bold w-12 text-right">{lvl.rate}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-gray-400 font-medium">Total Commission</span>
                  <span className="text-2xl font-bold text-violet-400">30%</span>
                </div>
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
          <h2 className="text-3xl font-bold text-white mb-4">Ready to get started?</h2>
          <p className="text-gray-400 mb-8 max-w-md mx-auto">
            Sign in to manage your subscriptions and start earning with the referral program.
          </p>
          <Link
            href={user ? '/dashboard' : '/login'}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white font-semibold py-3.5 px-8 rounded-xl transition-all duration-300 shadow-lg shadow-violet-500/25 text-lg"
          >
            {user ? 'Open Dashboard' : 'Sign In'}
            <ArrowRight className="w-5 h-5" />
          </Link>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <span className="text-sm text-gray-500">INITE Billing Service</span>
          <span className="text-sm text-gray-600">Powered by INITE</span>
        </div>
      </footer>
    </div>
  )
}
